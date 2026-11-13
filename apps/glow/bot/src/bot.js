// What GlowBot does with each Telegram message and button press, for one chat.
//
// Plain messages go to GlowChat (with a short memory). Commands reach the other Glow services:
//   /lead <goal>   GlowLead plans, waits for "Start", runs the steps one by one and reports
//   /search <q>    the GlowRoom crew researches the live web and cites its sources
//   /news          the current GlowNews edition
//   /spark [text]  a short tale from GlowSpark, Glow's own small model
// The Durable Object (index.js) owns storage and timing; everything here receives a `ctx`:
//   { chatId, storage, telegram, complete, describeModels, web, spark, now, schedule, registry, isOwner, botUsername, signal }

import { ModelsBusyError } from "./models.js";
import {
  WORKERS,
  describeError,
  fixUpStep,
  planMission,
  research,
  reviewMission,
  runStep,
  today,
} from "./lead.js";
import { escapeHtml } from "./telegram.js";
import { StoppedError, clip, errorText } from "./util.js";

const HISTORY_KEY = "chat:history";
const MISSION_KEY = "mission";
const HISTORY_TURNS = 12;
const MAX_TRIES = 3;
const ACTIVE = ["planning", "awaiting", "working", "checking"];
const GLOW = "https://juw12.github.io/projects/glow";

export const COMMANDS = [
  { command: "lead", description: "Give GlowLead a goal: it plans, delegates and checks" },
  { command: "search", description: "Research the live web with sources (GlowRoom crew)" },
  { command: "news", description: "Today's AI news from GlowNews" },
  { command: "spark", description: "A tiny tale from GlowSpark, Glow's own model" },
  { command: "stop", description: "Stop the running mission" },
  { command: "new", description: "Start a fresh chat (forget this conversation)" },
  { command: "models", description: "Which free models are answering" },
  { command: "help", description: "What GlowBot can do" },
];

const HONESTY =
  "Do not invent product names, prices, statistics, sources or links. Say plainly when something should be checked.";

const HELP = [
  "✨ **GlowBot**: Glow's AI team in Telegram, free.",
  "",
  "Just write to chat with **GlowChat**. It remembers this conversation until you send /new.",
  "",
  "**/lead** _goal_: **GlowLead** plans the job, shows you the plan, and after you tap Start it hands each step to GlowChat, the Council or the GlowRoom crew, then checks the work against done-criteria and reports.",
  "**/search** _question_: the **GlowRoom crew** searches and reads the live web and cites its sources.",
  "**/news**: the latest **GlowNews** edition.",
  "**/spark** _opening_: a tiny tale from **GlowSpark**, a model Glow trained from scratch.",
  "**/stop** stops a mission · **/models** shows which free models answer · **/myid** shows your Telegram id",
  "",
  `Everything runs on free models. Glow on the web: ${GLOW}/`,
].join("\n");

const OWNER_HELP = "\n\n**Owner**: /allow _id_ lets someone use this bot, /deny _id_ removes them, /users lists who can.";

// "/lead@GlowBot plan a trip" -> { command: "lead", args: "plan a trip" }. A command meant for
// another bot in a group comes back as { command: null } so it is ignored.
export function parseCommand(text, botUsername) {
  const match = String(text || "").match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!match) return { command: "", args: String(text || "").trim() };
  if (match[2] && botUsername && match[2].toLowerCase() !== String(botUsername).toLowerCase()) return { command: null, args: "" };
  return { command: match[1].toLowerCase(), args: (match[3] || "").trim() };
}

function busyText(error) {
  const seconds = Math.max(5, Math.ceil(((error && error.retryInMs) || 30000) / 1000));
  return `All the free models are busy right now. Try again in about ${seconds} s.`;
}

async function reply(ctx, markdown, extra) {
  return ctx.telegram.sendMarkdown(ctx.chatId, markdown, extra);
}

// ------------------------------------------------------------------ GlowChat

async function chat(ctx, text) {
  const history = (await ctx.storage.get(HISTORY_KEY)) || [];
  await ctx.telegram.typing(ctx.chatId);
  const system = [
    `You are GlowChat, the assistant of Glow (${GLOW}/), talking with the user in Telegram.`,
    "Answer clearly and to the point: short paragraphs, Markdown lists when they help, no filler.",
    HONESTY,
    "When the user wants a multi-step job done (research, compare, plan, write a report), suggest sending /lead followed by the goal.",
    `Today is ${today(ctx.now)}.`,
  ].join(" ");
  let answer;
  try {
    answer = await ctx.complete({
      messages: [{ role: "system", content: system }, ...history, { role: "user", content: clip(text, 4000) }],
      maxTokens: 1500,
      signal: ctx.signal,
    });
  } catch (error) {
    if (error instanceof ModelsBusyError) return reply(ctx, busyText(error));
    throw error;
  }
  const next = [...history, { role: "user", content: clip(text, 2000) }, { role: "assistant", content: clip(answer.text, 2000) }];
  await ctx.storage.put(HISTORY_KEY, next.slice(-HISTORY_TURNS));
  return reply(ctx, answer.text);
}

// ------------------------------------------------------------------ other services

async function searchCommand(ctx, question) {
  if (!question) return reply(ctx, "Send **/search** followed by what to look up, for example `/search best e-bike under $1000 in 2026`.");
  await ctx.telegram.typing(ctx.chatId);
  try {
    const found = await research({ complete: ctx.complete, web: ctx.web, question, now: ctx.now, signal: ctx.signal });
    const credit = found.models.length ? `\n\n_GlowRoom crew · searched "${found.query}" · ${[...new Set(found.models)].join(", ")}_` : "";
    return reply(ctx, found.text + credit);
  } catch (error) {
    if (error instanceof ModelsBusyError) return reply(ctx, busyText(error));
    throw error;
  }
}

function briefingLines(briefing) {
  if (!Array.isArray(briefing)) return [];
  return briefing
    .map((item) => (typeof item === "string" ? item : item && (item.text || item.point || item.summary || item.title)))
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, 5);
}

async function newsCommand(ctx) {
  let edition;
  try {
    edition = await ctx.web.news(ctx.signal);
  } catch (error) {
    return reply(ctx, `GlowNews could not be reached just now (${clip(errorText(error), 120)}). It lives at ${GLOW}/news/`);
  }
  const stories = edition.stories.slice(0, 6);
  const when = String(edition.generated_at || "").slice(0, 16).replace("T", " ");
  const lines = [`📰 **GlowNews**${when ? ` · edition of ${when} UTC` : ""}`, ""];
  const briefing = briefingLines(edition.briefing);
  if (briefing.length) {
    lines.push("**Briefing**", ...briefing.map((point) => `• ${clip(point, 240)}`), "");
  }
  stories.forEach((story, index) => {
    const title = String(story.title || "Untitled").replace(/[[\]]/g, "");
    const head = story.url ? `**${index + 1}. [${title}](${story.url})**` : `**${index + 1}. ${title}**`;
    lines.push(head);
    if (story.summary) lines.push(clip(story.summary, 240));
    const meta = [story.source, story.topic].filter(Boolean).join(" · ");
    if (meta) lines.push(`_${meta}_`);
    lines.push("");
  });
  lines.push(`More stories: ${GLOW}/news/`);
  return reply(ctx, lines.join("\n"));
}

async function sparkCommand(ctx, opening) {
  const start = clip(opening || "Once upon a time", 200);
  await ctx.telegram.typing(ctx.chatId);
  try {
    await ctx.spark.load(ctx.signal);
    const tale = ctx.spark.write(start, { maxTokens: 120 });
    return reply(
      ctx,
      `✨ **GlowSpark**\n\n${start}${tale.text}\n\n_A ${(ctx.spark.info().parameters / 1e6).toFixed(1)}M-parameter model Glow trained from scratch on old storybooks. It writes tales, not facts._`,
    );
  } catch (error) {
    return reply(ctx, `GlowSpark could not start just now (${clip(errorText(error), 120)}).`);
  }
}

function modelsText(ctx) {
  const rows = ctx.describeModels().map((entry, index) => {
    const resting = entry.restingMs > 0 ? ` · resting ${Math.ceil(entry.restingMs / 1000)} s` : "";
    return `${index === 0 ? "▶️" : "•"} ${entry.name} _(${entry.label})_${resting}`;
  });
  return ["**Free models, in the order GlowBot asks them**", ...rows, "", "The first one answered last; a model that fails rests for a while."].join("\n");
}

async function ownerCommand(ctx, command, args) {
  if (!ctx.isOwner) return reply(ctx, "Only the owner of this GlowBot can do that.");
  if (command === "users") {
    const list = await ctx.registry("/users");
    return reply(ctx, `**Who can use this bot**\n${list.users.map((id) => `• \`${id}\`${id === list.owner ? " (owner)" : ""}`).join("\n")}`);
  }
  const id = Number(String(args || "").trim());
  if (!Number.isSafeInteger(id) || id <= 0) return reply(ctx, `Send **/${command}** followed by a Telegram id. The person can get theirs with /myid.`);
  const result = await ctx.registry("/" + command, { userId: id });
  if (!result.ok) return reply(ctx, result.error || "That did not work.");
  return reply(ctx, command === "allow" ? `✅ \`${id}\` can use this bot now.` : `🚫 \`${id}\` can no longer use this bot.`);
}

// ------------------------------------------------------------------ GlowLead missions

function newId(now) {
  return now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const STEP_MARK = { done: "✅", running: "⏳", failed: "⚠️", stopped: "⏹", pending: "▫️" };
const STATUS_LINE = {
  planning: "🧭 Planning the work…",
  awaiting: "Plan ready. Tap <b>Start</b> to send the team to work.",
  working: "The team is working…",
  checking: "🔎 Checking the work against the done-criteria…",
  done: "✅ Done. The report is below.",
  stopped: "⏹ Stopped.",
  error: "⚠️ Could not finish.",
};

// The mission card: one message that is edited as the mission moves along.
export function missionHtml(mission) {
  const lines = [`🧭 <b>GlowLead mission</b>`, `<b>Goal:</b> ${escapeHtml(clip(mission.goal, 600))}`];
  if (mission.summary) lines.push(`<i>${escapeHtml(mission.summary)}</i>`);
  if (mission.steps.length) {
    lines.push("", "<b>Plan</b>");
    mission.steps.forEach((step, index) => {
      const worker = WORKERS[step.worker] || WORKERS.chat;
      const mark = STEP_MARK[step.status || "pending"] || STEP_MARK.pending;
      lines.push(`${mark} ${index + 1}. ${worker.icon} ${escapeHtml(step.title)} <i>· ${worker.name}</i>`);
    });
  }
  if (mission.criteria.length) {
    lines.push("", "<b>Done when</b>");
    mission.criteria.forEach((criterion, index) => {
      const met = mission.met ? mission.met[index] : undefined;
      const mark = met === true ? "✅" : met === false ? "❌" : "•";
      lines.push(`${mark} ${escapeHtml(criterion)}`);
    });
  }
  const status = STATUS_LINE[mission.status] || "";
  lines.push("", mission.status === "error" && mission.error ? `${status} ${escapeHtml(mission.error)}` : status);
  if (mission.note) lines.push(`<i>${escapeHtml(mission.note)}</i>`);
  return lines.join("\n");
}

export function missionButtons(mission) {
  if (mission.status === "awaiting") {
    return {
      inline_keyboard: [
        [
          { text: "▶️ Start", callback_data: `go:${mission.id}` },
          { text: "✖️ Cancel", callback_data: `cancel:${mission.id}` },
        ],
      ],
    };
  }
  if (["planning", "working", "checking"].includes(mission.status)) {
    return { inline_keyboard: [[{ text: "⏹ Stop", callback_data: `stop:${mission.id}` }]] };
  }
  return { inline_keyboard: [] };
}

async function showMission(ctx, mission) {
  if (!mission.messageId) return;
  try {
    await ctx.telegram.editHtml(ctx.chatId, mission.messageId, missionHtml(mission), { reply_markup: missionButtons(mission) });
  } catch (error) {
    console.log("could not update the mission card: " + errorText(error));
  }
}

async function loadMission(ctx) {
  return (await ctx.storage.get(MISSION_KEY)) || null;
}

async function saveMission(ctx, mission) {
  mission.updatedAt = ctx.now();
  await ctx.storage.put(MISSION_KEY, mission);
}

async function startMission(ctx, goal) {
  if (!goal) {
    return reply(ctx, "Send **/lead** followed by your goal, for example:\n`/lead plan a 3-day trip to Tokyo in March on a $1500 budget`");
  }
  const current = await loadMission(ctx);
  if (current && ACTIVE.includes(current.status)) {
    return reply(ctx, "A mission is already under way. Finish it, or send /stop first.");
  }
  const mission = {
    id: newId(ctx.now),
    goal: clip(goal, 1500),
    status: "planning",
    summary: "",
    criteria: [],
    steps: [],
    models: [],
    createdAt: ctx.now(),
  };
  const card = await ctx.telegram.sendHtml(ctx.chatId, missionHtml(mission), mission.goal, { reply_markup: missionButtons(mission) });
  mission.messageId = card && card.message_id;
  await saveMission(ctx, mission);
  try {
    const plan = await planMission({ complete: ctx.complete, goal: mission.goal, now: ctx.now, signal: ctx.signal });
    const latest = await loadMission(ctx);
    if (!latest || latest.id !== mission.id || latest.status !== "planning") return null; // stopped while planning
    Object.assign(mission, {
      status: "awaiting",
      summary: plan.summary,
      criteria: plan.criteria,
      steps: plan.steps.map((step) => ({ ...step, status: "pending" })),
      models: plan.model ? [plan.model] : [],
      note: plan.planned ? "" : "The planner did not answer in the expected form, so GlowLead used its standard plan.",
    });
  } catch (error) {
    if (error instanceof StoppedError) return null;
    mission.status = "error";
    mission.error = error instanceof ModelsBusyError ? busyText(error) : describeError(error);
  }
  await saveMission(ctx, mission);
  await showMission(ctx, mission);
  return mission;
}

// Button presses on a mission card. Returns the text for the little pop-up Telegram shows.
async function missionButton(ctx, action, id) {
  const mission = await loadMission(ctx);
  if (!mission || mission.id !== id) return "That mission is no longer here.";
  if (action === "go") {
    if (mission.status !== "awaiting") return "This plan has already been started or closed.";
    mission.status = "working";
    mission.next = 0;
    mission.tries = 0;
    await saveMission(ctx, mission);
    await showMission(ctx, mission);
    await ctx.schedule(ctx.now());
    return "The team is on it.";
  }
  if (action === "cancel" || action === "stop") {
    return (await stopMission(ctx)) ? "Stopped." : "Nothing is running.";
  }
  return "";
}

// Stop whatever mission is running. Safe to call from any path; returns true when it stopped one.
export async function stopMission(ctx) {
  const mission = await loadMission(ctx);
  if (!mission || !ACTIVE.includes(mission.status)) return false;
  mission.status = "stopped";
  mission.steps.forEach((step) => {
    if (step.status === "running") step.status = "stopped";
  });
  await saveMission(ctx, mission);
  await showMission(ctx, mission);
  return true;
}

function finalReport(mission, review) {
  const check = mission.criteria.map((criterion, index) => {
    const met = review.met[index];
    return `${met === true ? "✅" : met === false ? "❌" : "❔"} ${criterion}`;
  });
  const metCount = review.met.filter((value) => value === true).length;
  const lines = [review.report.trim(), "", "---", `**GlowLead check: ${metCount} of ${mission.criteria.length} met**`, ...check];
  if (review.missing) lines.push(`_Still missing: ${review.missing}_`);
  if (!review.checked) lines.push("_The checker's verdict could not be read in full, so unmarked criteria are unknown._");
  const models = [...new Set(mission.models.filter(Boolean))];
  if (models.length) lines.push(`_Models: ${models.join(", ")}_`);
  return lines.join("\n");
}

// Do the next part of the running mission: one step, or the check. Returns the time the next part
// should run, or null when nothing is left to do.
export async function advanceMission(ctx) {
  const mission = await loadMission(ctx);
  if (!mission || !["working", "checking"].includes(mission.status)) return null;
  const startedId = mission.id;
  const startedStatus = mission.status;

  // Something else (a Stop button) may have changed the mission while a model was answering.
  async function stillCurrent() {
    const latest = await loadMission(ctx);
    return !!latest && latest.id === startedId && latest.status === startedStatus;
  }

  async function retryLater(error) {
    mission.tries = (mission.tries || 0) + 1;
    if (mission.tries > MAX_TRIES) {
      mission.status = "error";
      mission.error = busyText(error);
      mission.steps.forEach((step) => {
        if (step.status === "running") step.status = "pending";
      });
      await saveMission(ctx, mission);
      await showMission(ctx, mission);
      return null;
    }
    const waitMs = Math.max(15000, error.retryInMs || 30000);
    mission.note = `The free models are busy; trying again in ${Math.ceil(waitMs / 1000)} s (attempt ${mission.tries + 1} of ${MAX_TRIES + 1}).`;
    await saveMission(ctx, mission);
    await showMission(ctx, mission);
    return ctx.now() + waitMs;
  }

  try {
    if (mission.status === "working") {
      const index = mission.next || 0;
      const step = mission.steps[index];
      step.status = "running";
      mission.note = "";
      await saveMission(ctx, mission);
      await showMission(ctx, mission);
      await ctx.telegram.typing(ctx.chatId);
      const result = await runStep({ complete: ctx.complete, web: ctx.web, mission, index, now: ctx.now, signal: ctx.signal });
      if (!(await stillCurrent())) return null;
      step.output = result.output;
      step.failed = !!result.failed;
      step.status = result.failed ? "failed" : "done";
      mission.models.push(...result.models);
      mission.next = index + 1;
      mission.tries = 0;
      if (mission.next >= mission.steps.length) mission.status = "checking";
      await saveMission(ctx, mission);
      await showMission(ctx, mission);
      return ctx.now();
    }

    const review = await reviewMission({ complete: ctx.complete, mission, now: ctx.now, signal: ctx.signal });
    if (!(await stillCurrent())) return null;
    mission.models.push(review.model);
    const extra = fixUpStep(mission, review);
    if (extra) {
      mission.fixedUp = true;
      mission.steps.push({ ...extra, status: "pending" });
      mission.status = "working";
      mission.tries = 0;
      mission.note = `The check found a gap, so GlowLead added one more step: ${clip(review.missing, 160)}`;
      await saveMission(ctx, mission);
      await showMission(ctx, mission);
      return ctx.now();
    }
    mission.status = "done";
    mission.met = review.met;
    mission.note = "";
    mission.finishedAt = ctx.now();
    await saveMission(ctx, mission);
    await reply(ctx, finalReport(mission, review));
    await showMission(ctx, mission);
    return null;
  } catch (error) {
    if (error instanceof StoppedError) return null;
    if (!(await stillCurrent())) return null;
    if (error instanceof ModelsBusyError) return retryLater(error);
    mission.status = "error";
    mission.error = describeError(error);
    await saveMission(ctx, mission);
    await showMission(ctx, mission);
    return null;
  }
}

// ------------------------------------------------------------------ one update

export async function handleUpdate(ctx, update) {
  if (update.callback_query) {
    const query = update.callback_query;
    const [action, id] = String(query.data || "").split(":");
    const text = await missionButton(ctx, action, id);
    await ctx.telegram.answerCallback(query.id, text);
    return;
  }
  const message = update.message;
  if (!message) return;
  if (typeof message.text !== "string") {
    if (message.chat && message.chat.type === "private") await reply(ctx, "I can only read text for now. Write your message, or send /help.");
    return;
  }
  const { command, args } = parseCommand(message.text, ctx.botUsername);
  if (command === null) return;
  switch (command) {
    case "":
      return chat(ctx, message.text);
    case "start":
      return reply(ctx, (ctx.paired ? "🎉 You are now the owner of this GlowBot.\n\n" : "") + HELP + (ctx.isOwner ? OWNER_HELP : ""));
    case "help":
      return reply(ctx, HELP + (ctx.isOwner ? OWNER_HELP : ""));
    case "lead":
    case "mission":
      return startMission(ctx, args);
    case "stop":
      return reply(ctx, (await stopMission(ctx)) ? "⏹ Mission stopped." : "No mission is running.");
    case "search":
      return searchCommand(ctx, args);
    case "news":
      return newsCommand(ctx);
    case "spark":
      return sparkCommand(ctx, args);
    case "new":
    case "reset":
      await ctx.storage.delete(HISTORY_KEY);
      return reply(ctx, "🧹 Fresh start: GlowChat has forgotten this conversation.");
    case "models":
    case "status":
      return reply(ctx, modelsText(ctx));
    case "myid":
      return reply(ctx, `Your Telegram id is \`${message.from && message.from.id}\`. This chat's id is \`${message.chat && message.chat.id}\`.`);
    case "allow":
    case "deny":
    case "users":
      return ownerCommand(ctx, command, args);
    default:
      return reply(ctx, `I don't know /${command}. Send /help to see what I can do.`);
  }
}
