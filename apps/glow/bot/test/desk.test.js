// The desk: the owner's notes, links and posts, and the Guard. The private words here are made up.

import test from "node:test";
import assert from "node:assert/strict";

import { DESK_CAP, GUARD_WORDS, NOTE_CLIP, createDesk, exportMarkdown, hasSecret, parseWords, scanText, stamp, wordHits } from "../src/desk.js";
import { FakeStorage, makeClock } from "./fakes.js";

const START = Date.UTC(2026, 10, 11, 19, 30);
const UTC7 = 7 * 60 * 60 * 1000;
// Shapes of secrets, put together here so that no file holds anything that looks like a real key.
const BOT_TOKEN = "123456789" + ":" + "A".repeat(35);
const GITHUB_TOKEN = "gh" + "p_" + "a1B2".repeat(9);
const API_KEY = "s" + "k-" + "x9".repeat(12);

function makeDesk() {
  const storage = new FakeStorage();
  const now = makeClock(START);
  return { storage, now, desk: createDesk({ storage, now }) };
}

test("parseWords: lower case, trimmed, no doubles, 2 to 40 characters", () => {
  assert.deepEqual(parseWords(" BlueFern, quartzite ,bluefern\nRed  Kite; x, " + "y".repeat(41)), ["bluefern", "quartzite", "red kite"]);
  assert.deepEqual(parseWords(""), []);
  assert.deepEqual(parseWords(null), []);
});

test("wordHits: whole words only, any case, and a word with dots or pluses is taken literally", () => {
  assert.equal(wordHits("The BlueFern build is late", ["bluefern"]), 1);
  assert.equal(wordHits("bluefern-2 and (quartzite).", ["bluefern", "quartzite"]), 2);
  assert.equal(wordHits("bluefernish quartzites", ["bluefern", "quartzite"]), 0);
  assert.equal(wordHits("ship v1.2+ today", ["v1.2+"]), 1);
  assert.equal(wordHits("ship v112 today", ["v1.2"]), 0);
  assert.equal(wordHits("anything", []), 0);
});

test("hasSecret: tokens, keys and password lines are spotted; ordinary text is not", () => {
  assert.equal(hasSecret(`token ${BOT_TOKEN}`), true);
  assert.equal(hasSecret(`use ${GITHUB_TOKEN} here`), true);
  assert.equal(hasSecret(`key ${API_KEY}`), true);
  assert.equal(hasSecret("password: hunter22"), true);
  assert.equal(hasSecret("API_KEY=abcd1234"), true);
  assert.equal(hasSecret("I forgot my password again"), false);
  assert.equal(hasSecret("12 kN / (20 mm * 5 mm) to MPa"), false);
  assert.equal(hasSecret("meet at 10:30, room 123456789"), false);
});

test("scanText: counts the private words and never names them", () => {
  assert.deepEqual(scanText("bluefern meets quartzite", ["bluefern", "quartzite", "kite"]), { words: 2, secret: false, clean: false });
  assert.deepEqual(scanText("password=abcd1234", []), { words: 0, secret: true, clean: false });
  assert.deepEqual(scanText("a quiet week", ["bluefern"]), { words: 0, secret: false, clean: true });
});

test("stamp: the owner's clock, to the minute", () => {
  assert.equal(stamp(START, UTC7), "2026-11-12 02:30");
  assert.equal(stamp(START), "2026-11-11 19:30");
});

test("notes: kept in order, with their time and kind, and cut at the limit", async () => {
  const { desk, now } = makeDesk();
  await desk.addNote("first");
  now.advance(60000);
  await desk.addNote("did the thing", "log");
  await desk.addNote("x".repeat(NOTE_CLIP + 50));
  const notes = await desk.notes();
  assert.deepEqual(notes.map((note) => [note.n, note.kind]), [[1, "note"], [2, "log"], [3, "note"]]);
  assert.equal(notes[0].at, START);
  assert.equal(notes[1].at, START + 60000);
  assert.equal(notes[2].text.length, NOTE_CLIP);
  assert.deepEqual((await desk.notes(2)).map((note) => note.n), [2, 3]);
});

test("notes: only the newest are kept once the desk is full", async () => {
  const { desk, storage } = makeDesk();
  for (let index = 1; index <= DESK_CAP + 3; index += 1) await desk.addNote(`note ${index}`);
  const notes = await desk.notes();
  assert.equal(notes.length, DESK_CAP);
  assert.equal(notes[0].text, "note 4");
  assert.equal(notes[notes.length - 1].text, `note ${DESK_CAP + 3}`);
  assert.equal([...storage.map.keys()].filter((key) => key.startsWith("desk:n:")).length, DESK_CAP);
});

test("links: saved once, the second time it is the one already there", async () => {
  const { desk } = makeDesk();
  const first = await desk.addLink("https://example.com/a", "A page");
  const again = await desk.addLink("https://example.com/a", "Another title");
  await desk.addLink("https://example.com/b");
  assert.equal(first.saved, true);
  assert.equal(again.saved, false);
  assert.equal(again.link.title, "A page");
  assert.deepEqual((await desk.links()).map((link) => [link.url, link.title]), [["https://example.com/a", "A page"], ["https://example.com/b", ""]]);
});

test("guard: words are added once, counted, capped and cleared", async () => {
  const { desk } = makeDesk();
  assert.deepEqual(await desk.guard(), []);
  assert.deepEqual(await desk.addGuard("BlueFern, quartzite"), { added: 2, total: 2 });
  assert.deepEqual(await desk.addGuard("bluefern, kite"), { added: 1, total: 3 });
  assert.deepEqual(await desk.guard(), ["bluefern", "quartzite", "kite"]);
  const many = Array.from({ length: GUARD_WORDS + 20 }, (unused, index) => `word${index}`).join(",");
  assert.equal((await desk.addGuard(many)).total, GUARD_WORDS);
  await desk.clearGuard();
  assert.deepEqual(await desk.guard(), []);
});

test("posts: nothing is kept until it is approved, and a second answer finds nothing waiting", async () => {
  const { desk } = makeDesk();
  const pending = await desk.propose("Shipped the new build today.");
  assert.deepEqual(await desk.posts(), []);
  assert.equal(await desk.decide("999", true), null);
  const done = await desk.decide(pending.id, true);
  assert.equal(done.approved, true);
  assert.equal(done.post.text, "Shipped the new build today.");
  assert.equal(await desk.decide(pending.id, true), null);
  assert.equal((await desk.posts()).length, 1);
});

test("posts: a rejected post is dropped, and a newer draft replaces the one that was waiting", async () => {
  const { desk } = makeDesk();
  const first = await desk.propose("draft one");
  const second = await desk.propose("draft two");
  assert.notEqual(first.id, second.id);
  assert.equal(await desk.decide(first.id, true), null);
  assert.deepEqual(await desk.decide(second.id, false), { approved: false, post: null });
  assert.deepEqual(await desk.posts(), []);
});

test("the desk is all in storage: a new desk object on the same storage sees everything", async () => {
  const { desk, storage, now } = makeDesk();
  await desk.addNote("keep me");
  await desk.addLink("https://example.com/a", "A page");
  await desk.addGuard("bluefern");
  const pending = await desk.propose("waiting");
  const later = createDesk({ storage, now });
  assert.equal((await later.notes())[0].text, "keep me");
  assert.equal((await later.links())[0].title, "A page");
  assert.deepEqual(await later.guard(), ["bluefern"]);
  assert.equal((await later.decide(pending.id, true)).approved, true);
  const all = await later.all();
  assert.deepEqual([all.notes.length, all.links.length, all.posts.length, all.guard.length], [1, 1, 1, 1]);
});

test("exportMarkdown: three sections, the owner's clock, and guarded items hidden", () => {
  const file = exportMarkdown({
    notes: [
      { n: 1, at: START, kind: "note", text: "buy bearings\ntomorrow" },
      { n: 2, at: START, kind: "log", text: "bluefern slipped a week" },
    ],
    links: [
      { n: 1, at: START, url: "https://example.com/a", title: "A page" },
      { n: 2, at: START, url: "https://example.com/b", title: "" },
      { n: 3, at: START, url: "https://example.com/c", title: "Quartzite notes" },
    ],
    posts: [{ n: 1, at: START, text: "Shipped it." }],
    guard: ["bluefern", "quartzite"],
    now: START,
    offsetMs: UTC7,
    hidden: "(hidden by Guard)",
  });
  assert.match(file, /^# Glow desk\n\nExported 2026-11-12 02:30\n/);
  assert.match(file, /## Notes \(2\)\n\n- 2026-11-12 02:30 buy bearings tomorrow\n- 2026-11-12 02:30 \[log\] \(hidden by Guard\)\n/);
  assert.match(file, /## Links \(3\)\n\n- 2026-11-12 02:30 A page: https:\/\/example\.com\/a\n- 2026-11-12 02:30 https:\/\/example\.com\/b: https:\/\/example\.com\/b\n- 2026-11-12 02:30 \(hidden by Guard\)\n/);
  assert.match(file, /## Posts \(1\)\n\n### 2026-11-12 02:30\n\nShipped it\.\n$/);
  assert.ok(!/bluefern|quartzite/i.test(file));
});
