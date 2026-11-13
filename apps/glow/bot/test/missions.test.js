// The mission engine, driven the way the chat's Durable Object drives it: one unit per alarm, with the
// job saved and loaded between units. The AI models and the web are scripted, so every run is the same.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENTS,
  ASK_ALIASES,
  ROOM_CREW,
  SKILLS,
  agentOf,
  askStep,
  boardButtons,
  boardText,
  createJob,
  crewSystem,
  dateLine,
  failJob,
  failUnit,
  planMessage,
  planSystem,
  prepareUnit,
  reportPosts,
  runUnit,
} from "../src/missions.js";
import { BOTS } from "../src/crew-port.js";
import { StoppedError } from "../src/util.js";
import { busyError, fakeWeb, scripted } from "./fakes.js";

const NOW = Date.UTC(2026, 10, 11, 19, 30); // 02:30 on 12 November in Batam
const TODAY = "Thu Nov 12 2026";

// ------------------------------------------------------------------ stand-ins
function context(models, extra = {}) {
  return { models, web: fakeWeb(), spark: null, now: () => NOW, signal: undefined, lang: "en", history: [], ...extra };
}

function newJob(kind, goal, extra = {}) {
  return createJob({ id: 7, kind, goal, by: 1001, at: NOW, ...extra });
}

// Runs units until the job stops being active or shows a plan. The job goes through JSON between
// units, as it does when the chat saves it and a later alarm loads it again.
async function drive(job, ctx, { limit = 40, failures = false } = {}) {
  const posts = [];
  let current = job;
  let plan = false;
  let units = 0;
  while (current.status === "active" && units < limit) {
    units += 1;
    current = JSON.parse(JSON.stringify(current));
    prepareUnit(current, ctx.lang);
    let out;
    try {
      out = await runUnit(current, ctx);
    } catch (error) {
      if (!failures) throw error;
      out = failUnit(current, error, ctx);
    }
    posts.push(...out.posts);
    if (out.plan) {
      plan = true;
      break;
    }
  }
  assert.ok(units < limit, "the job never settled");
  return { job: current, posts, plan, units };
}

const PLAN = /^You are GlowLead, the lead of a team/;
const REVIEW = /^You are GlowLead, the team lead/;
const CHAT_STEP = /^You are GlowChat, working for GlowLead/;
const BUILDER = /^You are the Builder/;
const CRITIC = /^You are the Critic/;
const JUDGE = /^You are the Judge/;
const QUERY = /^Write ONE concise web search query/;
const SCOUT = /^You are Scout, the Research Agent/;
const NOVA_PLAN = /^You are Nova, lead of an AI crew/;
const NOVA_FINAL = /^You are Nova, the Team Lead/;
const BYTE = /^You are Byte/;
const PROBE = /^You are Probe/;
const PIXEL = /^You are Pixel/;
const GLOWCHAT = /^You are GlowChat, the Glow AI assistant/;

const BAKERY_GOAL = "Write a welcome message for my bakery";
const BAKERY_PLAN = JSON.stringify({
  summary: "Decide the tone, then write it.",
  criteria: ["Friendly tone", "Under 80 words"],
  steps: [
    { worker: "council", title: "Decide the tone", task: "Decide which tone fits a small bakery." },
    { worker: "chat", title: "Write the message", task: "Write the welcome message." },
  ],
});
const ALL_MET = '\n\nCHECK: {"met":[true,true],"missing":""}';

function bakeryRules(overrides = []) {
  return [
    ...overrides,
    [PLAN, BAKERY_PLAN],
    [BUILDER, "Builder: go warm."],
    [CRITIC, "Critic: too long."],
    [JUDGE, "Judge: warm and short."],
    [CHAT_STEP, "Welcome to our bakery!"],
    [REVIEW, "Welcome to our bakery!" + ALL_MET],
  ];
}

const PI_GOAL = "What is the price of the Raspberry Pi 5 today";
const PI_PLAN = JSON.stringify({
  summary: "Look it up, then answer.",
  criteria: ["Names a current price", "Gives a source link"],
  steps: [
    { worker: "room", title: "Find the price", task: "Find the current price of the Raspberry Pi 5." },
    { worker: "chat", title: "Write the answer", task: "Write a short answer with the price." },
  ],
});
const PI_PAGE = [
  "Skip to content",
  "The Raspberry Pi 5 with 8 GB of memory is listed at $80 by the official store this week.",
  "Menu",
  "Delivery takes about a week according to the reseller's own page about shipping times.",
].join("\n");
const PI_RESULTS = [
  { title: "Raspberry Pi 5 price list", url: "https://shop.example/pi5", snippet: "Pi 5 prices today." },
  { title: "Pi 5 review", url: "https://news.example/review", snippet: "A review of the Pi 5." },
  { title: "Where to buy", url: "https://buy.example/where", snippet: "Shops that sell the Pi 5." },
  { title: "Forum thread", url: "https://forum.example/t/1", snippet: "People talk about the Pi 5 price." },
];
const PI_PAGES = {
  "https://shop.example/pi5": PI_PAGE,
  "https://news.example/review": new Error("blocked"),
  "https://buy.example/where": PI_PAGE,
};

function piRules(overrides = []) {
  return [
    ...overrides,
    [PLAN, PI_PLAN],
    [QUERY, '"Raspberry Pi 5 price"\n'],
    [SCOUT, "The Pi 5 (8 GB) is $80 [1]."],
    [CHAT_STEP, "It costs $80."],
    [REVIEW, "It costs $80 [1]." + ALL_MET],
  ];
}

// ------------------------------------------------------------------ small things
test("the date line is the calendar date in Batam, written like Date.toDateString", () => {
  assert.equal(dateLine(NOW), TODAY);
  assert.equal(dateLine(Date.UTC(2026, 0, 3, 16, 59)), "Sat Jan 03 2026");
  assert.equal(dateLine(Date.UTC(2026, 0, 3, 17, 0)), "Sun Jan 04 2026");
  assert.equal(dateLine(Date.UTC(2026, 0, 3, 17, 0), 0), new Date(Date.UTC(2026, 0, 3, 17, 0)).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+).*$/, "$1 $3 $2 $4"));
});

test("a new job starts active, in the plan phase for a team and in the work phase for the rest", () => {
  const lead = newJob("lead", "goal");
  assert.deepEqual([lead.status, lead.phase, lead.steps.length, lead.calls, lead.halted], ["active", "plan", 0, 0, false]);
  assert.equal(newJob("room", "goal").phase, "plan");
  for (const kind of ["ask", "chat", "spark", "agent"]) assert.equal(newJob(kind, "goal").phase, "work");
  assert.deepEqual(JSON.parse(JSON.stringify(lead)), lead);
});

test("every name a person may type after /ask leads to an agent of the team", () => {
  for (const [typed, id] of Object.entries(ASK_ALIASES)) {
    assert.ok(Object.hasOwn(AGENTS, id), typed);
    assert.equal(typed, typed.toLowerCase());
  }
  for (const agent of Object.values(AGENTS)) assert.ok(Object.hasOwn(ASK_ALIASES, agent.key), agent.key);
  assert.equal(ASK_ALIASES.scout, "explore");
  assert.equal(ASK_ALIASES.byte, "coder");
  assert.equal(ASK_ALIASES.nova, "leader");
  for (const id of ROOM_CREW) assert.ok(Object.hasOwn(BOTS, id) && Object.hasOwn(SKILLS, id), id);
  assert.ok(!ROOM_CREW.includes("leader"));
});

test("a step is shown under the agent that does it", () => {
  assert.equal(agentOf({ worker: "chat" }).name, "GlowChat");
  assert.equal(agentOf({ worker: "council" }).name, "GlowChat Council");
  assert.equal(agentOf({ worker: "room" }).name, "Scout");
  assert.equal(agentOf({ bot: "coder" }).name, "Byte");
  assert.equal(agentOf({ worker: "toString" }).name, "GlowChat");
  assert.equal(agentOf(askStep("explore", "x")).name, "Scout");
  assert.equal(agentOf(askStep("leader", "x")).name, "Nova");
});

test("Byte, Probe and Pixel are told honestly what they cannot do inside a Worker", () => {
  assert.match(crewSystem("coder", "", NOW), /^You are Byte, the Software Developer in an AI crew called GlowRoom\. You writes JavaScript and other code as text/);
  assert.match(SKILLS.coder, /cannot run code here/);
  assert.match(SKILLS.tester, /cannot run code here/);
  assert.doesNotMatch(SKILLS.media, /draws|SVG/);
  assert.equal(SKILLS.explore, BOTS.explore.skill);
  assert.ok(crewSystem("explore", "extra line", NOW).includes(`Today's date: ${TODAY}.`));
  assert.ok(crewSystem("explore", "extra line", NOW).endsWith("\nextra line"));
});

// ------------------------------------------------------------------ GlowLead
test("a mission is planned, waits for the OK, is worked on step by step, checked and reported", async () => {
  const models = scripted(bakeryRules());
  const ctx = context(models);

  const planned = await drive(newJob("lead", BAKERY_GOAL), ctx);
  assert.equal(planned.plan, true);
  assert.equal(planned.units, 1);
  assert.deepEqual(planned.posts, []);
  assert.deepEqual([planned.job.status, planned.job.phase, planned.job.planned, planned.job.simple], ["awaiting", "work", true, false]);
  assert.deepEqual(planned.job.steps.map((step) => [step.worker, step.title, step.status]), [
    ["council", "Decide the tone", "queued"],
    ["chat", "Write the message", "queued"],
  ]);
  assert.equal(models.calls.length, 1);
  assert.equal(models.calls[0].system, planSystem());
  assert.equal(models.calls[0].user, "Goal: " + BAKERY_GOAL);
  assert.equal(models.calls[0].maxTokens, 900);

  const plan = planMessage(planned.job, "en");
  assert.equal(plan.html, [
    "👑 <b>GlowLead's plan</b>",
    "Decide the tone, then write it.",
    "",
    "<b>Done when</b>",
    "• Friendly tone",
    "• Under 80 words",
    "",
    "<b>Steps</b>",
    "1. ⚖️ <b>GlowChat Council</b>: Decide the tone",
    "2. 💬 <b>GlowChat</b>: Write the message",
    "",
    "Run it? To change the plan, reply to this message with what to change.",
  ].join("\n"));
  assert.deepEqual(plan.buttons, [[
    { text: "▶️ Run", data: "run:7" },
    { text: "✏️ Change", data: "chg:7" },
    { text: "✖️ Cancel", data: "can:7" },
  ]]);

  planned.job.status = "active"; // the Run button
  const done = await drive(planned.job, ctx);
  assert.equal(done.plan, false);
  assert.deepEqual([done.job.status, done.job.checked, done.job.unverified], ["done", true, false]);
  assert.deepEqual(done.job.met, [true, true]);
  assert.equal(done.job.report, "Welcome to our bakery!");
  assert.equal(models.calls.length, 6); // plan, Builder, Critic, Judge, GlowChat, review
  assert.deepEqual(done.posts.map((post) => post.tag), ["agent", "agent", "agent", "agent", "final"]);
  assert.equal(done.posts[0].html, "⚖️ <b>GlowChat Council</b> · Builder · Decide the tone\n<blockquote expandable>Builder: go warm.</blockquote>");
  assert.equal(done.posts[1].html, "⚖️ <b>GlowChat Council</b> · Critic · Decide the tone\n<blockquote expandable>Critic: too long.</blockquote>");
  assert.equal(done.posts[2].html, "⚖️ <b>GlowChat Council</b> · Judge · Decide the tone\n<blockquote expandable>Judge: warm and short.</blockquote>");
  assert.equal(done.posts[3].html, "💬 <b>GlowChat</b> · Write the message\n<blockquote expandable>Welcome to our bakery!</blockquote>");
  assert.equal(done.posts[4].html, [
    "👑 <b>GlowLead's report</b>",
    "",
    "Welcome to our bakery!",
    "",
    "———",
    "<b>Done-criteria</b>",
    "✅ Friendly tone",
    "✅ Under 80 words",
  ].join("\n"));

  // What each worker was told.
  const [critic] = models.to(CRITIC);
  assert.ok(critic.user.includes("Overall goal: " + BAKERY_GOAL));
  assert.ok(critic.user.includes("Builder's answer:\nBuilder: go warm."));
  assert.deepEqual([models.to(BUILDER)[0].maxTokens, critic.maxTokens, models.to(JUDGE)[0].maxTokens], [1500, 900, 1800]);
  assert.ok(models.to(JUDGE)[0].user.includes("Builder:\nBuilder: go warm.\n\nCritic:\nCritic: too long."));
  const [writer] = models.to(CHAT_STEP);
  assert.ok(writer.user.startsWith("Overall goal: " + BAKERY_GOAL + "\n\nYour task: Write the welcome message."));
  assert.ok(writer.user.includes("Work already done by the team:\n### GlowChat Council: Decide the tone\nJudge: warm and short."));
  const [review] = models.to(REVIEW);
  assert.equal(review.maxTokens, 3000);
  assert.ok(review.user.includes("Done-criteria:\n1. Friendly tone\n2. Under 80 words"));
  assert.ok(review.user.includes("Team's work:\n### GlowChat Council: Decide the tone\nJudge: warm and short.\n\n### GlowChat: Write the message\nWelcome to our bakery!"));
});

test("a plan of one GlowChat step runs at once, and its answer is the report", async () => {
  const onlyChat = JSON.stringify({ summary: "Just answer.", criteria: ["Answers it"], steps: [{ worker: "chat", title: "Explain it", task: "Explain how yeast works." }] });
  const models = scripted([[PLAN, onlyChat], [CHAT_STEP, "Yeast eats sugar and makes gas."]]);
  const run = await drive(newJob("lead", "How does yeast work"), context(models));
  assert.equal(run.plan, false);
  assert.deepEqual([run.job.status, run.job.simple, run.units], ["done", true, 2]);
  assert.equal(models.calls.length, 2);
  assert.deepEqual(run.posts, [{ html: "👑 <b>GlowLead's report</b>\n\nYeast eats sugar and makes gas.", tag: "final" }]);
});

test("when the planner fails, a simple default plan is used and the plan says so", async () => {
  const models = scripted(piRules([[PLAN, new Error("upstream 500")]]));
  const run = await drive(newJob("lead", "Compare the latest phone prices"), context(models));
  assert.equal(run.plan, true);
  assert.deepEqual([run.job.status, run.job.planned, run.job.planKept], ["awaiting", false, false]);
  assert.deepEqual(run.job.steps.map((step) => step.worker), ["room", "chat"]);
  assert.equal(run.job.criteria.length, 2);
  assert.ok(planMessage(run.job, "en").html.includes("<i>Planned with a simple default because the planner was busy.</i>"));
  assert.ok(!planMessage(run.job, "en").html.includes("unchanged"));
});

test("a goal about prices always gets a live research step, even when the planner forgot it", async () => {
  const noResearch = JSON.stringify({ summary: "", criteria: ["Has a price"], steps: [{ worker: "chat", title: "Answer", task: "Say the price." }] });
  const models = scripted([[PLAN, noResearch]]);
  const run = await drive(newJob("lead", "What is the price of rice today"), context(models));
  assert.equal(run.plan, true);
  assert.deepEqual(run.job.steps.map((step) => step.worker), ["room", "chat"]);
  assert.equal(agentOf(run.job.steps[0]).name, "Scout");
});

test("a change to the plan is sent to the planner with the old plan, and a failed re-plan keeps the old plan", async () => {
  const shorter = JSON.stringify({ summary: "Shorter.", criteria: ["One line"], steps: [
    { worker: "chat", title: "Draft it", task: "Draft one line." },
    { worker: "council", title: "Pick the best", task: "Pick the best line." },
  ] });
  let planAnswers = [BAKERY_PLAN, shorter, new Error("upstream 500")];
  const models = scripted([[PLAN, () => planAnswers.shift()]]);
  const ctx = context(models);
  const first = await drive(newJob("lead", BAKERY_GOAL), ctx);

  Object.assign(first.job, { change: "make it one line", phase: "plan", status: "active" });
  const second = await drive(first.job, ctx);
  assert.equal(second.plan, true);
  assert.ok(models.calls[1].user.includes("The plan you made before:\n1. [council] Decide the tone: Decide which tone fits a small bakery.\n2. [chat] Write the message: Write the welcome message."));
  assert.ok(models.calls[1].user.includes("The user wants this changed:\nmake it one line"));
  assert.deepEqual(second.job.steps.map((step) => step.title), ["Draft it", "Pick the best"]);
  assert.deepEqual([second.job.change, second.job.planKept, second.job.status], ["", false, "awaiting"]);

  Object.assign(second.job, { change: "add emojis", phase: "plan", status: "active" });
  const third = await drive(second.job, ctx);
  assert.equal(third.plan, true);
  assert.deepEqual(third.job.steps.map((step) => step.title), ["Draft it", "Pick the best"]);
  assert.deepEqual([third.job.change, third.job.planKept, third.job.status], ["", true, "awaiting"]);
  const html = planMessage(third.job, "en").html;
  assert.ok(html.includes("<i>The planner was busy, so the plan is unchanged.</i>"));
  assert.ok(!html.includes("simple default"));
});

test("a follow-up mission tells the planner about the earlier mission", async () => {
  const models = scripted(bakeryRules());
  const job = newJob("lead", "Now make it shorter", { context: "Goal: " + BAKERY_GOAL + "\n\nResult:\nWelcome to our bakery!" });
  await drive(job, context(models));
  assert.ok(models.calls[0].user.includes("This is a follow-up. Earlier mission and its result:\nGoal: " + BAKERY_GOAL));
});

// ------------------------------------------------------------------ Scout
test("Scout thinks of a search, reads the top three pages and writes from what it read", async () => {
  const models = scripted(piRules());
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  const job = newJob("ask", "price of the Raspberry Pi 5", { steps: [askStep("explore", "price of the Raspberry Pi 5")] });
  job.models = ["Test Model (Test)"];
  const run = await drive(job, context(models, { web }));

  assert.deepEqual([run.job.status, run.units, models.calls.length], ["done", 3, 2]);
  const [query] = models.to(QUERY);
  assert.equal(query.system, `Write ONE concise web search query (max 10 words) for the task. Today is ${TODAY}. Do not add a year unless the user mentioned one. Output only the query text.`);
  assert.deepEqual([query.temperature, query.maxTokens], [0, 60]);
  assert.deepEqual(web.calls.search, ["Raspberry Pi 5 price"]);
  assert.deepEqual(web.calls.read, ["https://shop.example/pi5", "https://news.example/review", "https://buy.example/where"]);

  const [write] = models.to(SCOUT);
  assert.ok(write.system.includes("You cannot browse, open links or search again."));
  assert.ok(write.user.startsWith("Your task: price of the Raspberry Pi 5\n\nSources (fetched just now):\n[1] Raspberry Pi 5 price list — https://shop.example/pi5\n"));
  assert.ok(write.user.includes("listed at $80 by the official store"));
  assert.ok(!write.user.includes("Skip to content"));
  assert.ok(write.user.includes("[2] Pi 5 review — https://news.example/review\nA review of the Pi 5.")); // the page was blocked: its snippet stands in
  assert.ok(write.user.includes("[4] Forum thread — https://forum.example/t/1\nPeople talk about the Pi 5 price."));

  const step = run.job.steps[0];
  assert.equal(step.researchFailed, false);
  assert.equal(step.sources.length, 4);
  assert.ok(step.output.startsWith("The Pi 5 (8 GB) is $80 [1].\n\n---\n**Sources the crew actually read**\n1. [Raspberry Pi 5 price list](https://shop.example/pi5)\n"));
  assert.equal(run.posts.length, 1);
  assert.equal(run.posts[0].tag, "final");
  assert.ok(run.posts[0].html.startsWith("🔎 <b>Scout</b>\n\nThe Pi 5 (8 GB) is $80 [1]."));
  assert.ok(run.posts[0].html.includes('<a href="https://shop.example/pi5">Raspberry Pi 5 price list</a>'));
  assert.ok(run.posts[0].html.endsWith("<i>Models: Test Model (Test)</i>"));
});

test("Scout does not repeat the source list when its answer already shows the addresses", async () => {
  const models = scripted(piRules([[SCOUT, "It is $80, see https://shop.example/pi5"]]));
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  const run = await drive(newJob("ask", "pi price", { steps: [askStep("explore", "pi price")] }), context(models, { web }));
  assert.equal(run.job.steps[0].output, "It is $80, see https://shop.example/pi5");
});

test("with no search results Scout answers from memory, says so, and the research counts as failed", async () => {
  const models = scripted(piRules([[SCOUT, "It was about $80 at launch; I could not check that live."]]));
  const web = fakeWeb({ results: [] });
  const run = await drive(newJob("ask", "pi price", { steps: [askStep("explore", "pi price")] }), context(models, { web }));
  const [write] = models.to(SCOUT);
  assert.ok(write.system.includes("The live web search returned nothing just now"));
  assert.ok(!write.system.includes("ALREADY been fetched"));
  assert.ok(!write.user.includes("Sources (fetched just now)"));
  assert.deepEqual(web.calls.read, []);
  assert.deepEqual([run.job.steps[0].researchFailed, run.job.steps[0].sources.length], [true, 0]);
  assert.equal(run.job.steps[0].output, "It was about $80 at launch; I could not check that live.");
});

test("a search that throws is treated like a search that found nothing", async () => {
  const models = scripted(piRules());
  const web = fakeWeb({ results: new Error("search engines down") });
  const run = await drive(newJob("ask", "pi price", { steps: [askStep("explore", "pi price")] }), context(models, { web }));
  assert.deepEqual([run.job.status, run.job.steps[0].researchFailed], ["done", true]);
});

test("when the query call fails for an ordinary reason, Scout searches for the task itself", async () => {
  const models = scripted(piRules([[QUERY, new Error("upstream 500")]]));
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  await drive(newJob("ask", "pi price in Batam", { steps: [askStep("explore", "pi price in Batam")] }), context(models, { web }));
  assert.deepEqual(web.calls.search, ["pi price in Batam"]);
});

test("an answer that is only thinking out loud is asked for once more, more strictly", async () => {
  const leaky = "Let me search the web. Let me open the first link. I will check the price. We need to find more.";
  const models = scripted(piRules([
    [/IMPORTANT: Output ONLY the final answer/, "It is $80 [1]."],
    [SCOUT, leaky],
  ]));
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  const run = await drive(newJob("ask", "pi price", { steps: [askStep("explore", "pi price")] }), context(models, { web }));
  assert.equal(models.to(SCOUT).length, 2);
  assert.equal(models.to(SCOUT)[1].temperature, 0.2);
  assert.ok(run.job.steps[0].output.startsWith("It is $80 [1]."));
});

test("the board says what Scout is doing right now", async () => {
  const models = scripted(piRules());
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  const ctx = context(models, { web });
  let job = (await drive(newJob("lead", PI_GOAL), ctx)).job;
  job.status = "active";
  const notes = [];
  for (let unit = 0; unit < 3; unit++) {
    prepareUnit(job, "en");
    notes.push(job.note);
    assert.equal(boardText(job, "en").split("\n").at(-1), `<i>${job.note}</i>`);
    await runUnit(job, ctx);
  }
  assert.deepEqual(notes, ["thinking of a search", "reading the web: Raspberry Pi 5 price", "writing from 4 sources"]);
  prepareUnit(job, "en");
  assert.equal(job.note, "");
  assert.deepEqual(job.steps.map((step) => step.status), ["done", "active"]);
});

// ------------------------------------------------------------------ research that fails
test("research that fails is redone once, and a good second try makes the report checked again", async () => {
  const models = scripted(piRules());
  const web = fakeWeb({ results: (searchNumber) => (searchNumber === 1 ? [] : PI_RESULTS), pages: PI_PAGES });
  const ctx = context(models, { web });
  const planned = await drive(newJob("lead", PI_GOAL), ctx);
  planned.job.status = "active";
  const run = await drive(planned.job, ctx);

  assert.equal(run.job.status, "done");
  assert.deepEqual(run.job.steps.map((step) => [step.title, step.status, Boolean(step.researchFailed), Boolean(step.redone)]), [
    ["Find the price", "done", true, true],
    ["Write the answer", "done", false, false],
    ["Redo the live research", "done", false, false],
  ]);
  assert.deepEqual([run.job.steps[2].worker, run.job.steps[2].redoOf, run.job.steps[2].fixup], ["room", 0, true]);
  assert.ok(run.job.steps[2].task.startsWith("Find the current price of the Raspberry Pi 5.\n\nThe first try failed. Also make sure of: Required live research failed; retry it rather than inventing evidence."));

  // The writer was warned, and so was the first review.
  assert.ok(models.to(CHAT_STEP)[0].user.includes("IMPORTANT: the live web research step (Find the price) FAILED, so you have NO checked current data."));
  const reviews = models.to(REVIEW);
  assert.equal(reviews.length, 2);
  assert.ok(reviews[0].user.includes("NOTE: live research FAILED for: Find the price. Nothing above was checked on the live web."));
  assert.ok(!reviews[1].user.includes("live research FAILED"));
  assert.deepEqual([run.job.unverified, run.job.checked], [false, true]);
  assert.deepEqual(run.job.met, [true, true]);
  assert.ok(boardText(run.job, "en").includes("♻️ 🔎 Scout: Find the price"));
  assert.ok(!run.posts.at(-1).html.includes("research failed"));
});

test("research that fails twice gives a report marked unverified with every criterion unmet", async () => {
  const models = scripted(piRules());
  const ctx = context(models, { web: fakeWeb({ results: [] }) });
  const planned = await drive(newJob("lead", PI_GOAL), ctx);
  planned.job.status = "active";
  const run = await drive(planned.job, ctx);

  assert.equal(run.job.status, "done");
  assert.equal(run.job.steps.length, 3); // one redo, never a second
  assert.equal(models.to(REVIEW).length, 2);
  assert.deepEqual([run.job.unverified, run.job.missing], [true, ""]);
  assert.deepEqual(run.job.met, [false, false]);
  const report = run.posts.at(-1).html;
  assert.ok(report.includes("❌ Names a current price\n❌ Gives a source link\n⚠️ The live web research failed, so facts, prices and links were not checked."));
});

test("a check that finds something missing sends it back to GlowChat once", async () => {
  let reviews = 0;
  const models = scripted(bakeryRules([
    [REVIEW, () => {
      reviews += 1;
      return reviews === 1
        ? 'Draft.\n\nCHECK: {"met":[true,false],"missing":"It is 120 words long"}'
        : 'Short welcome.\n\nCHECK: {"met":[true,false],"missing":"Still 90 words"}';
    }],
  ]));
  const ctx = context(models);
  const planned = await drive(newJob("lead", BAKERY_GOAL), ctx);
  planned.job.status = "active";
  const run = await drive(planned.job, ctx);

  assert.equal(run.job.steps.length, 3);
  const fix = run.job.steps[2];
  assert.deepEqual([fix.worker, fix.title, fix.fixup, fix.status], ["chat", "Fix what the check found missing", true, "done"]);
  assert.equal(fix.task, "The check found this still missing: It is 120 words long. Improve the team's work so every done-criterion is met: Friendly tone; Under 80 words");
  assert.equal(reviews, 2);
  assert.deepEqual(run.job.met, [true, false]);
  assert.ok(run.posts.at(-1).html.endsWith("✅ Friendly tone\n❌ Under 80 words\nStill missing: Still 90 words"));
});

// ------------------------------------------------------------------ failures
test("a step that fails is marked, and the mission goes on with the next step", async () => {
  const models = scripted(bakeryRules([[BUILDER, new Error("boom")]]));
  const ctx = context(models);
  const planned = await drive(newJob("lead", BAKERY_GOAL), ctx);
  planned.job.status = "active";
  const run = await drive(planned.job, ctx, { failures: true });

  assert.equal(run.job.status, "done");
  assert.deepEqual(run.job.steps.map((step) => step.status).slice(0, 2), ["error", "done"]);
  assert.equal(run.job.steps[0].error, "boom");
  assert.deepEqual(run.posts[0], { html: "⚖️ <b>GlowChat Council</b> · Decide the tone\n⚠️ This step failed: boom", tag: "agent" });
  assert.ok(boardText(run.job, "en").includes("⚠️ ⚖️ GlowChat Council: Decide the tone"));
  assert.ok(!models.to(REVIEW)[0].user.includes("Decide the tone"));
});

test("when no step can be finished the mission fails and says why", async () => {
  const models = scripted(bakeryRules([[BUILDER, new Error("boom")], [CHAT_STEP, new Error("bang")]]));
  const ctx = context(models);
  const planned = await drive(newJob("lead", BAKERY_GOAL), ctx);
  planned.job.status = "active";
  const run = await drive(planned.job, ctx, { failures: true });
  assert.deepEqual([run.job.status, run.job.error], ["error", "boom"]);
  assert.deepEqual(run.posts.at(-1), { html: "⚠️ The mission could not be finished: boom", tag: "note" });
  assert.equal(models.to(REVIEW).length, 0);
  assert.equal(boardText(run.job, "en").split("\n")[1], "Failed");
});

test("a one-step mission that fails says so instead of posting an empty report", async () => {
  const onlyChat = JSON.stringify({ summary: "", criteria: ["Answers it"], steps: [{ worker: "chat", title: "Explain it", task: "Explain." }] });
  const models = scripted([[PLAN, onlyChat], [CHAT_STEP, new Error("bang")]]);
  const run = await drive(newJob("lead", "How does yeast work"), context(models), { failures: true });
  assert.deepEqual([run.job.status, run.job.error], ["error", "bang"]);
  assert.deepEqual(run.posts, [{ html: "⚠️ The mission could not be finished: bang", tag: "note" }]);
});

test("when the final check cannot run, the team's work is delivered and marked as not checked", async () => {
  const models = scripted(bakeryRules([[REVIEW, new Error("upstream 500")]]));
  const ctx = context(models);
  const planned = await drive(newJob("lead", BAKERY_GOAL), ctx);
  planned.job.status = "active";
  const run = await drive(planned.job, ctx, { failures: true });

  assert.deepEqual([run.job.status, run.job.checked, run.job.reviewError], ["done", false, "upstream 500"]);
  assert.deepEqual(run.job.met, [null, null]);
  assert.equal(run.job.report, "### GlowChat Council: Decide the tone\n\nJudge: warm and short.\n\n### GlowChat: Write the message\n\nWelcome to our bakery!");
  const report = run.posts.at(-1).html;
  assert.ok(report.includes("<b>GlowChat Council: Decide the tone</b>"));
  assert.ok(report.endsWith("➖ Friendly tone\n➖ Under 80 words\n⚠️ The final check could not run (upstream 500), so this is the team's work as it is, not checked against the done-criteria."));
});

test("failJob words the failure for the kind of job", () => {
  const ctx = context(scripted([]));
  assert.equal(failJob(newJob("ask", "x"), "bad", ctx).posts[0].html, "⚠️ That did not work: bad");
  assert.equal(failJob(newJob("room", "x"), "bad", ctx).posts[0].html, "⚠️ The mission could not be finished: bad");
  assert.equal(failJob(newJob("spark", "x"), "bad", ctx).posts[0].html, "GlowSpark could not write right now. Try again in a minute.");
  const job = newJob("chat", "x");
  const out = failJob(job, "", ctx, [{ html: "kept", tag: "agent" }]);
  assert.deepEqual([job.status, job.error, out.plan, out.posts.length, out.posts[0].html], ["error", "Something went wrong.", false, 2, "kept"]);
});

// ------------------------------------------------------------------ stopping and busy models
test("a stop is never swallowed, wherever it arrives", async () => {
  const stopped = AbortSignal.abort();
  const models = scripted(piRules());

  const planning = newJob("lead", PI_GOAL);
  await assert.rejects(runUnit(planning, context(models, { signal: stopped })), StoppedError);
  assert.deepEqual([planning.status, planning.phase, planning.steps.length], ["active", "plan", 0]);

  const planned = (await drive(newJob("lead", PI_GOAL), context(models))).job;
  planned.status = "active";
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  await assert.rejects(runUnit(planned, context(models, { web, signal: stopped })), StoppedError); // the query call
  assert.equal(planned.steps[0].sub, undefined);

  await runUnit(planned, context(models, { web }));
  assert.equal(planned.steps[0].sub, 1);
  await assert.rejects(runUnit(planned, context(models, { web, signal: stopped })), StoppedError); // the search
  assert.equal(planned.steps[0].sub, 1);

  await runUnit(planned, context(models, { web }));
  await assert.rejects(runUnit(planned, context(models, { web, signal: stopped })), StoppedError); // the writing call
  assert.deepEqual([planned.steps[0].sub, planned.steps[0].status, planned.steps[0].output], [2, "active", ""]);
});

test("a busy model leaves the job as it was, so the same unit can simply be tried again", async () => {
  let criticTries = 0;
  const models = scripted(bakeryRules([
    [CRITIC, () => {
      criticTries += 1;
      return criticTries === 1 ? busyError() : "Critic: too long.";
    }],
  ]));
  const ctx = context(models);
  const job = (await drive(newJob("lead", BAKERY_GOAL), ctx)).job;
  job.status = "active";
  await runUnit(job, ctx); // Builder
  const before = JSON.stringify(job);
  await assert.rejects(runUnit(job, ctx), { name: "ModelsBusyError" });
  assert.equal(JSON.stringify(job), before);
  const run = await drive(job, ctx);
  assert.equal(run.job.status, "done");
  assert.equal(criticTries, 2);
});

test("a busy model while Scout thinks of a search is passed up, not turned into a bad search", async () => {
  const models = scripted(piRules([[QUERY, busyError()]]));
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  const job = newJob("ask", "pi price", { steps: [askStep("explore", "pi price")] });
  await assert.rejects(runUnit(job, context(models, { web })), { name: "ModelsBusyError" });
  assert.deepEqual(web.calls.search, []);
  assert.equal(job.steps[0].sub, undefined);
});

test("an empty answer from a model counts as a failure", async () => {
  const models = scripted([[GLOWCHAT, "   "]]);
  await assert.rejects(runUnit(newJob("chat", "hi"), context(models)), /empty answer/);
});

// ------------------------------------------------------------------ steering
test("what the user types while the team works reaches every later call, but not the search query", async () => {
  const models = scripted(piRules());
  const web = fakeWeb({ results: PI_RESULTS, pages: PI_PAGES });
  const ctx = context(models, { web });
  const planned = await drive(newJob("lead", PI_GOAL), ctx);
  Object.assign(planned.job, { status: "active", steer: ["in rupiah please", "keep it under 50 words"] });
  await drive(planned.job, ctx);

  const note = "\n\nNew instructions from the user while you work (follow them):\n- in rupiah please\n- keep it under 50 words";
  assert.ok(!models.to(QUERY)[0].user.includes("New instructions"));
  assert.deepEqual(web.calls.search, ["Raspberry Pi 5 price"]);
  assert.ok(models.to(SCOUT)[0].user.endsWith(note));
  assert.ok(models.to(CHAT_STEP)[0].user.endsWith(note));
  assert.ok(models.to(REVIEW)[0].user.endsWith(note));
});

// ------------------------------------------------------------------ GlowRoom
const ROOM_GOAL = "Announce the Raspberry Pi 5 price to my club";
const ROOM_PLAN = '{"steps":[{"bot":"explore","task":"Find the current Raspberry Pi 5 price"},{"bot":"media","task":"Write a short club post"},{"bot":"leader","task":"Summarise"},{"bot":"painter","task":"Paint it"}]}';

function roomRules(overrides = []) {
  return [
    ...overrides,
    [NOVA_PLAN, ROOM_PLAN],
    [QUERY, "Raspberry Pi 5 price"],
    [SCOUT, "The Pi 5 (8 GB) is $80 [1]."],
    [PIXEL, "Good news, club: the Pi 5 is $80!"],
    [NOVA_FINAL, "The Pi 5 is $80 [1]. Post: Good news, club!"],
  ];
}

test("in a room run Nova plans, the crew works in turn, and Nova writes the final answer with the sources", async () => {
  const models = scripted(roomRules());
  const web = fakeWeb({ results: PI_RESULTS.slice(0, 2), pages: PI_PAGES });
  const run = await drive(newJob("room", ROOM_GOAL), context(models, { web }));

  assert.equal(run.plan, false); // a room run never waits for an OK
  assert.deepEqual([run.job.status, run.job.planned], ["done", true]);
  assert.deepEqual(run.job.steps.map((step) => [step.bot, step.title, step.worker]), [
    ["explore", "Find the current Raspberry Pi 5 price", undefined],
    ["media", "Write a short club post", undefined],
  ]); // Nova gives herself no step, and an unknown crew member is dropped

  const [plan] = models.to(NOVA_PLAN);
  assert.deepEqual([plan.temperature, plan.maxTokens, plan.user], [0.2, 600, ROOM_GOAL]);
  assert.ok(plan.system.includes("- coder (Byte): writes JavaScript and other code as text with a short explanation, and cannot run code here"));
  assert.ok(plan.system.includes("- explore (Scout): searches the live web, reads sources, reports facts with citations"));
  assert.ok(!plan.system.includes("actually runs it") && !plan.system.includes("draws SVG") && !plan.system.includes("- leader"));

  const [pixel] = models.to(PIXEL);
  assert.ok(pixel.system.includes("You cannot draw here"));
  assert.ok(pixel.user.startsWith("Overall goal: " + ROOM_GOAL + "\n\nWork done so far by teammates:\n### Scout (explore) — Find the current Raspberry Pi 5 price\nThe Pi 5 (8 GB) is $80 [1]."));
  assert.ok(pixel.user.endsWith("Your task: Write a short club post"));

  const [final] = models.to(NOVA_FINAL);
  assert.equal(final.maxTokens, 3000);
  assert.ok(final.system.includes("Keep the researcher's citation numbers [n] exactly as they are"));
  assert.ok(final.user.startsWith("Goal: " + ROOM_GOAL + "\n\nTeam work:\n### Scout (explore)"));
  assert.ok(final.user.includes("### Pixel (media) — Write a short club post\nGood news, club: the Pi 5 is $80!"));

  assert.deepEqual(run.posts.map((post) => post.tag), ["agent", "agent", "final"]);
  assert.ok(run.posts[0].html.startsWith("🔎 <b>Scout</b> · Find the current Raspberry Pi 5 price\n<blockquote expandable>The Pi 5 (8 GB) is $80 [1]."));
  assert.equal(run.posts[1].html, "🎨 <b>Pixel</b> · Write a short club post\n<blockquote expandable>Good news, club: the Pi 5 is $80!</blockquote>");
  assert.equal(run.job.final, "The Pi 5 is $80 [1]. Post: Good news, club!\n\n---\n**Sources the crew actually read**\n1. [Raspberry Pi 5 price list](https://shop.example/pi5)\n2. [Pi 5 review](https://news.example/review)");
  assert.ok(run.posts[2].html.startsWith("🏢 <b>Nova's final answer</b>\n\nThe Pi 5 is $80 [1]. Post: Good news, club!\n"));
  assert.ok(run.posts[2].html.includes('2. <a href="https://news.example/review">Pi 5 review</a>'));
});

test("a room run with one step posts that agent's answer once, as the final answer", async () => {
  const models = scripted(roomRules([[NOVA_PLAN, '{"steps":[{"bot":"media","task":"Write a short club post"}]}']]));
  const run = await drive(newJob("room", ROOM_GOAL), context(models));
  assert.deepEqual([run.job.status, models.calls.length, run.job.final], ["done", 2, "Good news, club: the Pi 5 is $80!"]);
  assert.deepEqual(run.posts, [{ html: "🎨 <b>Pixel</b>\n\nGood news, club: the Pi 5 is $80!", tag: "final" }]);
});

test("when Nova's planner fails, the built-in plan is used", async () => {
  const models = scripted(roomRules([[NOVA_PLAN, "I cannot plan right now."]]));
  const job = newJob("room", "Write a slogan for my bakery");
  await runUnit(job, context(models));
  assert.deepEqual([job.planned, job.phase, job.status], [false, "work", "active"]);
  assert.deepEqual(job.steps.map((step) => step.bot), ["media"]);
});

test("when Nova cannot write the final answer, the team's own work is handed over with a note", async () => {
  const models = scripted(roomRules([[NOVA_FINAL, new Error("upstream 500")]]));
  const web = fakeWeb({ results: PI_RESULTS.slice(0, 1), pages: PI_PAGES });
  const run = await drive(newJob("room", ROOM_GOAL), context(models, { web }), { failures: true });
  assert.equal(run.job.status, "done");
  const final = run.posts.at(-1);
  assert.equal(final.tag, "final");
  assert.ok(final.html.startsWith("🏢 <b>Nova's final answer</b>\n\n⚠️ Nova could not write the summary (upstream 500), so here is the team's work as it is.\n\n<b>Scout</b>\n"));
  assert.ok(final.html.includes("<b>Pixel</b>\nGood news, club: the Pi 5 is $80!"));
});

test("a room run where every step fails ends as a failure", async () => {
  const models = scripted(roomRules([[NOVA_PLAN, '{"steps":[{"bot":"media","task":"Write a post"},{"bot":"coder","task":"Write code"}]}'], [PIXEL, new Error("boom")], [BYTE, new Error("bang")]]));
  const run = await drive(newJob("room", ROOM_GOAL), context(models), { failures: true });
  assert.deepEqual([run.job.status, run.job.error], ["error", "boom"]);
  assert.deepEqual(run.posts.map((post) => post.tag), ["agent", "agent", "note"]);
  assert.equal(models.to(NOVA_FINAL).length, 0);
});

// ------------------------------------------------------------------ one agent
test("asking Byte or Probe gets code as text and a plain statement that nothing was run", async () => {
  const models = scripted([[BYTE, "```js\nconst sum = (a, b) => a + b;\n```\nRun it in a console to check."], [PROBE, "1. sum(1, 2) should be 3."]]);
  const ctx = context(models);
  const byte = await drive(newJob("ask", "write a sum function", { steps: [askStep("coder", "write a sum function")] }), ctx);
  const probe = await drive(newJob("ask", "test a sum function", { steps: [askStep("tester", "test a sum function")] }), ctx);

  const [coder] = models.to(BYTE);
  assert.ok(coder.system.includes("You cannot run code here, so do not claim it was executed or tested"));
  assert.equal(coder.user, "Your task: write a sum function");
  assert.ok(models.to(PROBE)[0].system.includes("You cannot run code here. Review the code and the work above"));
  assert.deepEqual([byte.units, byte.job.status, probe.job.status], [1, "done", "done"]);
  assert.equal(byte.posts.length, 1);
  assert.ok(byte.posts[0].html.startsWith("💻 <b>Byte</b>\n\n<pre>"));
  assert.equal(probe.posts[0].html, "🧪 <b>Probe</b>\n\n1. sum(1, 2) should be 3.");
});

test("asking the council gives three posts, and the Judge's answer is the result", async () => {
  const models = scripted(bakeryRules());
  const run = await drive(newJob("ask", "tea or coffee", { steps: [askStep("council", "tea or coffee")] }), context(models));
  assert.deepEqual(run.posts.map((post) => post.tag), ["agent", "agent", "final"]);
  assert.ok(run.posts[0].html.startsWith("⚖️ <b>GlowChat Council</b> · Builder · tea or coffee\n"));
  assert.equal(run.posts[2].html, "⚖️ <b>GlowChat Council</b> · Judge\n\nJudge: warm and short.");
  assert.equal(run.job.final, "Judge: warm and short.");
  assert.equal(models.to(BUILDER)[0].user, "Task: tea or coffee");
});

test("asking GlowChat or Nova is one call and one post", async () => {
  const models = scripted([[CHAT_STEP, "Four."], [NOVA_FINAL, "Here is the plan."]]);
  const ctx = context(models);
  const chat = await drive(newJob("ask", "2 + 2", { steps: [askStep("chat", "2 + 2")] }), ctx);
  const nova = await drive(newJob("ask", "plan my week", { steps: [askStep("leader", "plan my week")] }), ctx);
  assert.equal(models.calls[0].user, "Your task: 2 + 2");
  assert.deepEqual(chat.posts, [{ html: "💬 <b>GlowChat</b>\n\nFour.", tag: "final" }]);
  assert.deepEqual(nova.posts, [{ html: "🌟 <b>Nova</b>\n\nHere is the plan.", tag: "final" }]);
  assert.ok(models.calls[1].system.includes("Write the answer yourself, directly."));
});

// ------------------------------------------------------------------ chat and spark
test("a chat turn sends the earlier turns along and posts the answer with no header", async () => {
  const models = scripted([[GLOWCHAT, "Your name is **Juwen**."]]);
  const history = [{ role: "user", content: "My name is Juwen." }, { role: "assistant", content: "Nice to meet you." }];
  const run = await drive(newJob("chat", "What is my name?"), context(models, { history }));
  const [call] = models.calls;
  assert.deepEqual(call.messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.deepEqual(call.messages.slice(1), [...history, { role: "user", content: "What is my name?" }]);
  assert.ok(call.system.includes(`Today's date: ${TODAY}.`));
  assert.ok(call.system.endsWith("Reply in the language of the user's last message."));
  assert.equal(call.maxTokens, 1500);
  assert.deepEqual(run.posts, [{ html: "Your name is <b>Juwen</b>.", tag: "final" }]);
  assert.deepEqual([run.job.status, run.job.final], ["done", "Your name is **Juwen**."]);
});

test("GlowSpark writes on the Worker itself and offers to write again", async () => {
  const sparkCalls = [];
  const spark = {
    async load(signal) {
      sparkCalls.push(["load", signal]);
      return { parameters: 1311872 };
    },
    write(opening, options) {
      sparkCalls.push(["write", opening, options]);
      return { text: " who loved <jam>.\nThe end.", tokens: 8, ms: 3, seed: 1 };
    },
  };
  const models = scripted([]);
  const run = await drive(newJob("spark", "Once there was a fox"), context(models, { spark }));
  assert.equal(models.calls.length, 0);
  assert.deepEqual(sparkCalls, [["load", undefined], ["write", "Once there was a fox", { maxTokens: 260 }]]);
  assert.equal(run.job.final, "Once there was a fox who loved <jam>.\nThe end.");
  assert.equal(run.posts.length, 1);
  assert.equal(run.posts[0].html, [
    "✨ <b>GlowSpark</b>",
    "",
    "Once there was a fox who loved &lt;jam&gt;.",
    "The end.",
    "",
    "<i>A tiny AI we built from scratch. It only knows old storybooks, so it writes tales, not facts.</i>",
  ].join("\n"));
  assert.deepEqual(run.posts[0].buttons, [[{ text: "🔁 Again", data: "agn:7" }]]);

  const broken = { load: async () => { throw new Error("model file missing"); }, write: () => ({ text: "" }) };
  const failed = await drive(newJob("spark", "Once"), context(models, { spark: broken }), { failures: true });
  assert.deepEqual(failed.posts, [{ html: "GlowSpark could not write right now. Try again in a minute.", tag: "note" }]);
});

test("a job kind the engine does not know is an error, not a silent nothing", async () => {
  await assert.rejects(runUnit(newJob("agent", "x"), context(scripted([]))), /Unknown job kind: agent/);
});

// ------------------------------------------------------------------ the board
test("the board shows the state, the step in hand and the right buttons", () => {
  const job = newJob("lead", "Plan <my> week");
  Object.assign(job, { phase: "work", steps: [
    { worker: "room", title: "Look up dates", task: "t", status: "done", output: "x" },
    { worker: "chat", title: "Write the plan", task: "t", status: "active", output: "" },
    { worker: "council", title: "Review it", task: "t", status: "queued", output: "" },
  ] });
  assert.equal(boardText(job, "en"), [
    "👑 <b>Mission</b>: Plan &lt;my&gt; week",
    "Working · step 2 of 3",
    "✅ 🔎 Scout: Look up dates",
    "⏳ 💬 GlowChat: Write the plan",
    "▫️ ⚖️ GlowChat Council: Review it",
  ].join("\n"));
  assert.deepEqual(boardButtons(job, "en"), [[{ text: "⏸ Pause", data: "pau:7" }, { text: "⏹ Stop", data: "stp:7" }]]);

  job.status = "paused";
  job.note = "models busy";
  assert.equal(boardText(job, "en").split("\n")[1], "Paused");
  assert.ok(!boardText(job, "en").includes("models busy"));
  assert.deepEqual(boardButtons(job, "en"), [[{ text: "▶️ Resume", data: "res:7" }, { text: "⏹ Stop", data: "stp:7" }]]);

  for (const [status, line] of [["awaiting", "Waiting for your OK"], ["stopped", "Stopped"], ["done", "Done"], ["error", "Failed"]]) {
    job.status = status;
    assert.equal(boardText(job, "en").split("\n")[1], line);
    assert.deepEqual(boardButtons(job, "en"), []);
  }

  Object.assign(job, { status: "active", phase: "check" });
  assert.equal(boardText(job, "en").split("\n")[1], "Checking the work");
  assert.equal(boardText(job, "id").split("\n")[1], "Memeriksa hasil");

  const room = newJob("room", "Club post");
  assert.equal(boardText(room, "en"), "🏢 <b>GlowRoom</b>: Club post\nPlanning");
  Object.assign(room, { phase: "final" });
  assert.equal(boardText(room, "en").split("\n")[1], "Writing the final answer");
});

test("a report is cut into messages that each fit Telegram, and the criteria stay at the end", () => {
  const job = newJob("lead", "Long one");
  Object.assign(job, {
    status: "done",
    criteria: ["First <criterion>", "Second"],
    met: [true, null],
    missing: "",
    report: Array.from({ length: 400 }, (unused, index) => `Paragraph ${index + 1} of a long report that keeps going for a while.`).join("\n\n"),
    models: ["Llama 3.3 70B (OVHcloud)", "gpt-oss-120b (Workers AI)"],
  });
  const posts = reportPosts(job, "en");
  assert.ok(posts.length > 1);
  for (const post of posts) {
    assert.equal(post.tag, "final");
    assert.ok(post.html.length <= 4000, String(post.html.length));
  }
  assert.ok(posts[0].html.startsWith("👑 <b>GlowLead's report</b>\n\nParagraph 1 of"));
  assert.ok(posts.at(-1).html.endsWith("<b>Done-criteria</b>\n✅ First &lt;criterion&gt;\n➖ Second\n\n<i>Models: Llama 3.3 70B (OVHcloud), gpt-oss-120b (Workers AI)</i>"));
});
