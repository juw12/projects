// The bot copies prompt lines from the GlowLead and GlowRoom web apps (see FIXED_LINES in
// src/missions.js). This test reads the web apps' own source and fails when a copied line is no
// longer there, so the bot cannot quietly drift away from the apps it stands in for.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FIXED_LINES, SCOUT_ROOM_LINE, planSystem } from "../src/missions.js";
import { PLAN_SYSTEM } from "../src/lead-port.js";

function sourceOf(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const leadSource = sourceOf("../../web/lead/lead.js");
// crew-engine.js writes its prompts in single-quoted strings, so an apostrophe is written \' there.
const crewSource = sourceOf("../../web/room/crew-engine.js").replaceAll("\\'", "'");

function missingFrom(source, lines) {
  return lines.filter((line) => !source.includes(line));
}

test("every GlowLead line the bot copies is still in the web app, word for word", () => {
  assert.ok(FIXED_LINES.lead.length >= 20);
  assert.deepEqual(missingFrom(leadSource, FIXED_LINES.lead), []);
});

test("every GlowRoom line the bot copies is still in the web app, word for word", () => {
  assert.ok(FIXED_LINES.crew.length >= 25);
  assert.deepEqual(missingFrom(crewSource, FIXED_LINES.crew), []);
});

test("no copied line is empty or only spaces", () => {
  for (const line of [...FIXED_LINES.lead, ...FIXED_LINES.crew]) {
    assert.equal(typeof line, "string");
    assert.ok(line.trim().length >= 5, JSON.stringify(line));
  }
});

test("the bot's plan prompt is the web app's prompt with only the room line changed, plus the no-code line", () => {
  const webLines = PLAN_SYSTEM.split("\n");
  const botLines = planSystem().split("\n");
  assert.equal(botLines.length, webLines.length + 1);
  const changed = webLines.map((line, index) => (line === botLines[index] ? null : index)).filter((index) => index !== null);
  assert.equal(changed.length, 1);
  assert.ok(webLines[changed[0]].startsWith('- "room"'));
  assert.equal(botLines[changed[0]], SCOUT_ROOM_LINE);
  assert.ok(FIXED_LINES.lead.includes(webLines[changed[0]]));
  assert.ok(FIXED_LINES.lead.includes(botLines[botLines.length - 1]));
  assert.match(botLines[botLines.length - 1], /Code execution is NOT allowed/);
});

test("the bot's room line promises live research only, not a code runner", () => {
  assert.match(SCOUT_ROOM_LINE, /searches the live web/);
  assert.doesNotMatch(SCOUT_ROOM_LINE, /runs JavaScript|calculations or code/);
});
