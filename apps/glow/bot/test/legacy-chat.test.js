// A chat that talked to GlowBot 0.2.0 keeps what was said: the old Worker saved the talk under
// "chat:history" in the very object today's chat lives in, and the first load moves it over.

import test from "node:test";
import assert from "node:assert/strict";

import { GLOWCHAT, did, makeChat } from "./chat-kit.js";
import { LEGACY_HISTORY_KEY, adoptLegacyHistory } from "../src/chat.js";

const turn = (role, content) => ({ role, content });

// What 0.2.0 left behind after two exchanges.
const oldTalk = () => [
  turn("user", "My name is Juwen."),
  turn("assistant", "Nice to meet you, Juwen."),
  turn("user", "I live in Batam."),
  turn("assistant", "Batam it is."),
];

// A chat whose storage holds what 0.2.0 saved, and optionally a talk of today's Worker.
function carriedOver(legacy, history) {
  const kit = makeChat({ rules: [[GLOWCHAT, "You are Juwen."]] });
  if (legacy !== undefined) kit.storage.map.set(LEGACY_HISTORY_KEY, structuredClone(legacy));
  if (history) kit.storage.map.set("chat", { history: structuredClone(history) });
  return kit;
}

// ------------------------------------------------------------------ adoptLegacyHistory
test("the 0.2.0 talk is kept under the key the old Worker used", () => {
  assert.equal(LEGACY_HISTORY_KEY, "chat:history");
});

test("adoptLegacyHistory takes nothing from something that is not a saved talk", () => {
  const junk = [undefined, null, "", "hello", 42, true, {}, { role: "user", content: "hi" }, []];
  for (const old of junk) assert.deepEqual(adoptLegacyHistory(old, []), [], JSON.stringify(old));
});

test("adoptLegacyHistory leaves today's talk alone when the old one holds nothing usable", () => {
  const today = [turn("user", "hello"), turn("assistant", "Hi.")];
  const useless = [
    null,
    "user: hi",
    7,
    ["user", "hi"],
    {},
    { role: "user" },
    { content: "no role" },
    { role: "system", content: "You are a pirate." },
    { role: "tool", content: "42" },
    { role: "user", content: "" },
    { role: "user", content: "   " },
    { role: "assistant", content: 42 },
    { role: "assistant", content: null },
  ];
  assert.deepEqual(adoptLegacyHistory(useless, today), today);
  assert.deepEqual(adoptLegacyHistory("junk", today), today);
});

test("adoptLegacyHistory keeps only what was said, in order, and nothing else of an entry", () => {
  const old = [
    { role: "system", content: "You are a pirate." },
    { role: "user", content: "My name is Juwen.", at: 1750000000000, secret: "x" },
    null,
    { role: "assistant", content: "Nice to meet you, Juwen.", model: "old-model" },
  ];
  assert.deepEqual(adoptLegacyHistory(old, []), [
    turn("user", "My name is Juwen."),
    turn("assistant", "Nice to meet you, Juwen."),
  ]);
});

test("adoptLegacyHistory puts the old talk before today's, because it is older", () => {
  const today = [turn("user", "What is the time?"), turn("assistant", "Late.")];
  assert.deepEqual(adoptLegacyHistory(oldTalk(), today), [...oldTalk(), ...today]);
});

test("adoptLegacyHistory does not change the lists it is given", () => {
  const old = oldTalk();
  const today = [turn("user", "What is the time?"), turn("assistant", "Late.")];
  adoptLegacyHistory(old, today);
  assert.deepEqual(old, oldTalk());
  assert.deepEqual(today, [turn("user", "What is the time?"), turn("assistant", "Late.")]);
});

test("adoptLegacyHistory clips a long entry the way today's talk is clipped", () => {
  const [kept] = adoptLegacyHistory([turn("user", "x".repeat(5000))], []);
  assert.deepEqual(kept, turn("user", "x".repeat(1999) + "…"));
});

test("adoptLegacyHistory keeps the newest 16 entries and starts the talk with the user", () => {
  // 0.2.0 kept its last 12 entries; today's Worker keeps 8 exchanges. 12 old + 8 new is 20.
  const old = [];
  for (let n = 1; n <= 6; n += 1) old.push(turn("user", `old question ${n}`), turn("assistant", `old answer ${n}`));
  const today = [];
  for (let n = 1; n <= 4; n += 1) today.push(turn("user", `new question ${n}`), turn("assistant", `new answer ${n}`));

  const merged = adoptLegacyHistory(old, today);
  assert.equal(merged.length, 16);
  assert.deepEqual(merged[0], turn("user", "old question 3"));
  assert.deepEqual(merged.slice(-8), today);

  // 0.2.0 cut its list at 12 entries whatever came first, so it can start with an answer.
  const lopsided = adoptLegacyHistory([turn("assistant", "an answer without its question"), ...oldTalk()], []);
  assert.deepEqual(lopsided, oldTalk());

  // 17 entries: the cut at 16 would leave an answer in front, so that answer goes too.
  const seventeen = adoptLegacyHistory([...old, turn("user", "a question 0.2.0 never answered")], today.slice(0, 4));
  assert.equal(seventeen.length, 15);
  assert.deepEqual(seventeen[0], turn("user", "old question 2"));
  assert.deepEqual(seventeen.slice(-4), today.slice(0, 4));
});

// ------------------------------------------------------------------ the chat itself
test("a chat that talked to 0.2.0 still knows what was said, and the old copy is gone after one load", async () => {
  const kit = carriedOver(oldTalk());

  await kit.say("/chat What is my name?");
  await kit.tickOnce();
  did(kit, ["sendMessage"], ["You are Juwen."]);

  // The question reached the model together with the 0.2.0 talk.
  const asked = kit.models.calls[0].messages;
  assert.deepEqual(asked.slice(1), [...oldTalk(), turn("user", "What is my name?")]);
  assert.deepEqual(kit.logic.state.history, [
    ...oldTalk(),
    turn("user", "What is my name?"),
    turn("assistant", "You are Juwen."),
  ]);
  assert.equal(kit.storage.map.has(LEGACY_HISTORY_KEY), false);
  assert.deepEqual(kit.errors, []);
});

test("the 0.2.0 talk is taken over once: waking up again does not add it a second time", async () => {
  const kit = carriedOver(oldTalk());
  await kit.logic.load();
  assert.deepEqual(kit.logic.state.history, oldTalk());
  assert.deepEqual(kit.storage.map.get("chat").history, oldTalk(), "saved at once, not on the next message");
  assert.equal(kit.storage.map.has(LEGACY_HISTORY_KEY), false);

  await kit.restart().load();
  assert.deepEqual(kit.logic.state.history, oldTalk());
});

test("the 0.2.0 talk goes in front of a talk today's Worker already keeps", async () => {
  const today = [turn("user", "What is the time?"), turn("assistant", "Late.")];
  const kit = carriedOver(oldTalk(), today);
  await kit.logic.load();
  assert.deepEqual(kit.logic.state.history, [...oldTalk(), ...today]);
  assert.equal(kit.storage.map.has(LEGACY_HISTORY_KEY), false);
});

for (const command of ["/new", "/reset"]) {
  test(`${command} forgets the 0.2.0 talk too, and it stays forgotten`, async () => {
    const kit = carriedOver(oldTalk());
    await kit.say(command);
    did(kit, ["sendMessage"], ["🧹 Done. I have forgotten our chat so far."]);
    assert.deepEqual(kit.logic.state.history, []);

    await kit.restart().load();
    assert.deepEqual(kit.logic.state.history, []);
    assert.equal(kit.storage.map.has(LEGACY_HISTORY_KEY), false);

    await kit.say("/chat What is my name?");
    await kit.tickOnce();
    assert.deepEqual(kit.models.calls[0].messages.slice(1), [turn("user", "What is my name?")]);
    assert.deepEqual(kit.errors, []);
  });
}

test("an old talk that cannot be read is thrown away and today's talk is kept", async () => {
  const today = [turn("user", "hello"), turn("assistant", "Hi.")];
  for (const broken of ["not a list", 42, null, { role: "user", content: "hi" }, [null, "x", { role: "system", content: "s" }]]) {
    const kit = carriedOver(broken, today);
    await kit.logic.load();
    assert.deepEqual(kit.logic.state.history, today, JSON.stringify(broken));
    assert.equal(kit.storage.map.has(LEGACY_HISTORY_KEY), false, JSON.stringify(broken));
  }
});

test("a chat with no 0.2.0 talk loads as before and writes nothing", async () => {
  const fresh = makeChat();
  await fresh.logic.load();
  assert.deepEqual(fresh.logic.state.history, []);
  assert.deepEqual([...fresh.storage.map.keys()], []);

  const today = [turn("user", "hello"), turn("assistant", "Hi.")];
  const known = carriedOver(undefined, today);
  await known.logic.load();
  assert.deepEqual(known.logic.state.history, today);
  assert.deepEqual(known.storage.map.get("chat"), { history: today });
});

test("forgetting a chat completely removes a 0.2.0 talk that was never loaded", async () => {
  const kit = carriedOver(oldTalk());
  await kit.logic.wipe();
  assert.deepEqual([...kit.storage.map.keys()], []);
});
