// GlowBot's mission engine. It turns one job (a GlowLead mission, a GlowRoom run, one question to one
// agent, a chat turn or a GlowSpark tale) into small units of work: one model call or one batch of web
// reads each, so a unit always fits in one alarm of the chat's Durable Object.
//
// This file is pure: no Telegram calls and no storage. A unit changes the job object it is given and
// returns what to post; chat.js saves, sends and schedules. The planning, checking and context rules
// come from the web apps through lead-port.js and crew-port.js. The prompt lines typed here are copies
// of the web apps' lines, and test/prompts.test.js fails when one of them drifts.

import {
  BOTS,
  LANGUAGE_RULE,
  extractJson as extractCrewJson,
  heuristicPlan,
  looksLikeLeakedReasoning,
  priorWork,
  relevantExcerpt,
  truncate,
} from "./crew-port.js";
import {
  PLAN_SYSTEM,
  REVIEW_SYSTEM,
  WORKERS,
  backgroundFor,
  clip as clipTrim,
  contextFrom,
  ensureResearch,
  failedResearch,
  fallbackPlan,
  parsePlan,
  parseReview,
} from "./lead-port.js";
import { escapeHtml, t, tPlain } from "./strings.js";
import { mdToBlocks, mdToMessages, packBlocks, quoteMessages } from "./telegram.js";
import { StoppedError, clip, errorText } from "./util.js";

const STEP_OUTPUT_MAX = 12000;
const REPORT_MAX = 20000;

// ------------------------------------------------------------------ the team
// How each agent is shown in Telegram. "key" picks its agent.role.<key> line in strings.js.
export const AGENTS = {
  chat: { icon: "💬", name: "GlowChat", key: "chat" },
  council: { icon: "⚖️", name: "GlowChat Council", key: "council" },
  explore: { icon: "🔎", name: "Scout", key: "scout" },
  coder: { icon: "💻", name: "Byte", key: "byte" },
  tester: { icon: "🧪", name: "Probe", key: "probe" },
  checker: { icon: "🛡", name: "Sentinel", key: "sentinel" },
  media: { icon: "🎨", name: "Pixel", key: "pixel" },
  leader: { icon: "🌟", name: "Nova", key: "nova" },
};

// What a person may type after /ask.
export const ASK_ALIASES = {
  chat: "chat",
  glowchat: "chat",
  council: "council",
  scout: "explore",
  explore: "explore",
  research: "explore",
  byte: "coder",
  coder: "coder",
  probe: "tester",
  tester: "tester",
  sentinel: "checker",
  checker: "checker",
  pixel: "media",
  media: "media",
  nova: "leader",
  leader: "leader",
};

// The crew Nova may give work to in a /room run.
export const ROOM_CREW = ["explore", "coder", "tester", "checker", "media"];

// What each crew member does here. A Worker cannot run code or draw, so Byte, Probe and Pixel say so
// instead of repeating the web app's skills.
export const SKILLS = {
  leader: BOTS.leader.skill,
  explore: BOTS.explore.skill,
  coder: "writes JavaScript and other code as text with a short explanation, and cannot run code here",
  tester: "reviews code and lists the tests and edge cases to check, and cannot run code here",
  checker: BOTS.checker.skill,
  media: "writes copy (posts, emails, docs)",
};

export function agentOf(step) {
  const id = (step && step.bot) || (step && step.worker === "room" ? "explore" : step && step.worker);
  return Object.hasOwn(AGENTS, id) ? AGENTS[id] : AGENTS.chat;
}

export function isScout(step) {
  return step.bot === "explore" || (!step.bot && step.worker === "room");
}

// ------------------------------------------------------------------ prompt lines copied from the web apps
// GlowLead (apps/glow/web/lead/lead.js)
const CHAT_STEP_SYSTEM = "You are GlowChat, working for GlowLead (the team lead). Do the task completely and concretely. Use Markdown. No preamble. Never invent facts, product names, prices, ratings, sources or links: if you are not sure, say so.";
const BUILDER_SYSTEM = "You are the Builder in a GlowChat Council. Propose the best concrete answer to the task. Be specific.";
const CRITIC_SYSTEM = "You are the Critic in a GlowChat Council. Name the biggest weaknesses, risks or missing points in the Builder's answer (short bullets), then say how to fix them.";
const JUDGE_SYSTEM = "You are the Judge of a GlowChat Council. Write the final answer: lead with the decision, combine the Builder's proposal with the Critic's valid points, and end with a one-line confidence level.";
const NO_CODE_LINE = "Code execution is NOT allowed. The crew may research and draft code as text, but must not promise to execute or test it.";
const WEB_ROOM_LINE = '- "room" = GlowRoom crew: a researcher that reads the live web, a coder that runs JavaScript and a reviewer. Use it ONLY when a step needs current facts, prices, sources, calculations or code.';
const RESEARCH_FAILED_MISSING = "Required live research failed; retry it rather than inventing evidence.";
const REDO_TITLE = "Redo the live research";
const REDO_TAIL = "The first try failed. Also make sure of: ";
const FIX_TITLE = "Fix what the check found missing";
const FIX_HEAD = "The check found this still missing: ";
const FIX_DEFAULT = "some done-criteria are not met";
const FIX_TAIL = ". Improve the team's work so every done-criterion is met: ";
const NO_STEP_DONE = "No step could be finished.";

// GlowRoom (apps/glow/web/room/crew-engine.js)
const NOVA_PLAN_HEAD = "You are Nova, lead of an AI crew. Break the user goal into 1-4 concrete steps, each assigned to one crew member.";
const NOVA_PLAN_CREW = "Available crew:";
const NOVA_PLAN_RULES = [
  'Rules: use the fewest steps that produce a great result. Only use "explore" when current/real-world facts are needed.',
  'Use "coder" when computation, data processing, algorithms or code are involved; add "tester" after coder only for non-trivial code.',
  'Use "media" for writing copy or graphics. Use "checker" last when accuracy matters.',
  "Do NOT add a final summary step — you write the final answer yourself afterwards.",
  'Reply with JSON only: {"steps":[{"bot":"explore","task":"..."}]}',
];
const CREW_BE_CONCRETE = "Be concrete and genuinely useful: give the actual result, not a description of what you would do.";
const CREW_MARKDOWN = "Use Markdown. Keep it focused.";
const QUERY_HEAD = "Write ONE concise web search query (max 10 words) for the task. Today is ";
const QUERY_TAIL = ". Do not add a year unless the user mentioned one. Output only the query text.";
const SCOUT_LINES = [
  "The relevant text of each source has ALREADY been fetched for you and is included below. You cannot browse, open links or search again.",
  "Write the answer directly — do not describe your process or what you would do.",
  "Base facts on the sources and cite them inline like [1], [2]. If a detail is missing from the sources, say so briefly.",
  'Prefer a compact Markdown table when comparing items. End with a "Sources" list (number, title, URL).',
];
const SCOUT_RETRY_LINE = 'IMPORTANT: Output ONLY the final answer for the user. No planning, no "let\'s open", no narration.';
const NOVA_FINAL_LINES = [
  "Write the final deliverable for the user, combining your team's work. Lead with the answer.",
  "Keep the researcher's citation numbers [n] exactly as they are (do not invent new numbers); the source list is appended automatically. Include final code blocks or copy if they are part of the deliverable.",
  "If a reviewer requested changes, apply them. Do not describe the process; deliver the result.",
];
const CHECKER_EXTRA = 'Review the teammates\' work critically: list concrete errors, risks or gaps (with fixes), then give a verdict line: "Verdict: Approve" or "Verdict: Needs changes".';
const SOURCES_HEADING = "Sources the crew actually read";

// Every line and fragment above must still be in the web app it was copied from (test/prompts.test.js).
export const FIXED_LINES = {
  lead: [
    CHAT_STEP_SYSTEM,
    BUILDER_SYSTEM,
    CRITIC_SYSTEM,
    JUDGE_SYSTEM,
    NO_CODE_LINE,
    WEB_ROOM_LINE,
    RESEARCH_FAILED_MISSING,
    REDO_TITLE,
    REDO_TAIL,
    FIX_TITLE,
    FIX_HEAD,
    FIX_DEFAULT,
    FIX_TAIL,
    NO_STEP_DONE,
    "Overall goal: ",
    "Your task: ",
    "Builder's answer:",
    "Done-criteria:",
    "Team's work:",
    "NOTE: live research FAILED for: ",
    ". Nothing above was checked on the live web.",
  ],
  crew: [
    NOVA_PLAN_HEAD,
    NOVA_PLAN_CREW,
    ...NOVA_PLAN_RULES,
    CREW_BE_CONCRETE,
    CREW_MARKDOWN,
    QUERY_HEAD,
    QUERY_TAIL,
    ...SCOUT_LINES,
    SCOUT_RETRY_LINE,
    ...NOVA_FINAL_LINES,
    CHECKER_EXTRA,
    SOURCES_HEADING,
    " in an AI crew called GlowRoom. You ",
    "Today's date: ",
    "Sources (fetched just now):",
    "Earlier conversation context:",
    "Work done so far by teammates:",
    "Context from earlier work:",
    "Team work:",
    "Overall goal: ",
    "Your task: ",
  ],
};

// ------------------------------------------------------------------ the bot's own prompt lines
// In Telegram GlowLead's "room" worker is Scout alone: live research, no code runner.
export const SCOUT_ROOM_LINE = '- "room" = Scout, the GlowRoom researcher: it searches the live web, reads the top pages and answers with source links. Use it ONLY when a step needs current facts, prices, sources or news.';

const CREW_EXTRAS = {
  coder: "Write the code in one fenced code block with a short explanation. You cannot run code here, so do not claim it was executed or tested; say what the user should run to check it.",
  tester: "You cannot run code here. Review the code and the work above: list the tests and edge cases to check, with the expected result for each, and point out any bug you can see by reading.",
  checker: CHECKER_EXTRA,
  media: "Write the copy itself, ready to use. You cannot draw here: if a graphic was asked for, say so and describe it in words instead.",
  leader: "Write the answer yourself, directly. Lead with the answer.",
};
const SCOUT_NO_RESULTS = "The live web search returned nothing just now; answer from your own knowledge and say plainly that sources were not checked live.";
const CHAT_SYSTEM = [
  "You are GlowChat, the Glow AI assistant, talking with the user inside Telegram.",
  "Answer directly, in Markdown, short enough to read on a phone. Never invent facts, prices, sources or links: if you are not sure, say so.",
  "You cannot browse the web in this mode. For current facts, prices or news, tell the user to send /ask scout with their question, or /lead with their goal.",
];
const CHAT_LANGUAGE_RULE = "Reply in the language of the user's last message.";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The calendar date where the owner lives (UTC+7), written the way Date.toDateString() writes it.
export function dateLine(now, offsetMinutes = 420) {
  const local = new Date(Number(now) + offsetMinutes * 60000);
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${WEEKDAYS[local.getUTCDay()]} ${MONTHS[local.getUTCMonth()]} ${day} ${local.getUTCFullYear()}`;
}

// GlowLead's planning prompt with the one line about the "room" worker rewritten for Telegram.
export function planSystem() {
  const lines = PLAN_SYSTEM.split("\n").map((line) => (line.startsWith('- "room"') ? SCOUT_ROOM_LINE : line));
  return lines.join("\n") + "\n" + NO_CODE_LINE;
}

// GlowRoom's baseSystem(bot, extra), with the bot's honest skill line.
export function crewSystem(bot, extra, now) {
  const member = BOTS[bot];
  return [
    `You are ${member.name}, the ${member.role} in an AI crew called GlowRoom. You ${SKILLS[bot]}.`,
    CREW_BE_CONCRETE,
    CREW_MARKDOWN,
    `Today's date: ${dateLine(now)}.`,
    LANGUAGE_RULE,
    extra || "",
  ].join("\n");
}

// ------------------------------------------------------------------ jobs and steps
export function createJob({ id, kind, goal, by, at, replyTo = null, context = "", steps = [] }) {
  return {
    id,
    kind,
    status: "active",
    phase: kind === "lead" || kind === "room" ? "plan" : "work",
    goal,
    startedAt: at,
    by,
    replyTo,
    statusId: null,
    boardId: null,
    planId: null,
    askId: null,
    summary: "",
    criteria: [],
    steps,
    planned: false,
    planKept: false,
    simple: false,
    scratch: {},
    fixed: false,
    steer: [],
    change: "",
    note: "",
    retries: 0,
    retryAt: 0,
    calls: 0,
    journal: null,
    pending: null,
    halted: false,
    context,
    models: [],
    final: "",
    report: "",
    error: "",
  };
}

// The single step of an /ask job. Lead-style workers keep "worker" so the lead context rules apply.
export function askStep(botId, task) {
  const step = {
    worker: botId === "council" ? "council" : botId === "explore" ? "room" : "chat",
    title: clipTrim(task, 80),
    task,
    status: "queued",
    output: "",
  };
  if (botId !== "chat" && botId !== "council") step.bot = botId;
  return step;
}

function nextStepIndex(job) {
  return job.steps.findIndex((step) => step.status === "queued" || step.status === "active");
}

function finishStep(step, text) {
  step.output = clip(text, STEP_OUTPUT_MAX);
  step.status = "done";
  delete step.sub;
}

// ------------------------------------------------------------------ small helpers
function isStop(error, ctx) {
  return error instanceof StoppedError || Boolean(ctx.signal && ctx.signal.aborted);
}

function isBusy(error) {
  return Boolean(error) && error.name === "ModelsBusyError";
}

async function ask(ctx, system, user, { maxTokens = 2200, temperature = 0.4, history = [] } = {}) {
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: user }];
  const answer = await ctx.models.complete({ messages, temperature, maxTokens, signal: ctx.signal });
  const text = String((answer && answer.text) || "").trim();
  if (!text) throw new Error("The AI returned an empty answer.");
  return text;
}

// What the user typed while the team was working. It goes at the end of every later prompt.
function steerText(job) {
  const notes = (job.steer || []).slice(-3);
  if (!notes.length) return "";
  return "\n\nNew instructions from the user while you work (follow them):\n" + notes.map((note) => `- ${note}`).join("\n");
}

function goalLine(job) {
  return job.kind === "ask" ? "" : `Overall goal: ${job.goal}\n\n`;
}

function sourceList(sources) {
  if (!sources.length) return "";
  return `\n\n---\n**${SOURCES_HEADING}**\n` + sources
    .map((source, index) => `${index + 1}. [${String(source.title || source.url).replace(/[\[\]]/g, "")}](${source.url})`)
    .join("\n");
}

export function modelsLine(job, lang) {
  if (!job.models || !job.models.length) return "";
  return `<i>${t(lang, "report.models", { models: job.models.join(", ") })}</i>`;
}

function agentHeader(step, lang, roleKey) {
  const agent = agentOf(step);
  const role = roleKey ? ` · ${t(lang, roleKey)}` : "";
  return `${agent.icon} <b>${escapeHtml(agent.name)}</b>${role}`;
}

// One agent's work, folded into an expandable quote under its name.
function agentPosts(step, markdown, lang, roleKey) {
  const header = `${agentHeader(step, lang, roleKey)} · ${escapeHtml(step.title)}`;
  return quoteMessages(header, markdown).map((html) => ({ html, tag: "agent" }));
}

// One agent's answer shown in full: /ask results and a one-step /room run.
function soloPosts(step, markdown, job, lang, roleKey) {
  const blocks = [{ type: "text", lines: [agentHeader(step, lang, roleKey), ""] }, ...mdToBlocks(markdown)];
  const models = modelsLine(job, lang);
  if (models) blocks.push({ type: "text", lines: ["", models] });
  return packBlocks(blocks).map((html) => ({ html, tag: "final" }));
}

// ------------------------------------------------------------------ the workers
async function chatStep(job, index, ctx) {
  const step = job.steps[index];
  const user = `${goalLine(job)}Your task: ${step.task}${contextFrom(job, index)}${steerText(job)}`;
  finishStep(step, await ask(ctx, CHAT_STEP_SYSTEM + "\n" + LANGUAGE_RULE, user));
  return { done: true, posts: [] };
}

// Builder, Critic, Judge: three units and three posts.
async function councilStep(job, index, ctx) {
  const step = job.steps[index];
  const sub = step.sub || 0;
  const brief = `${goalLine(job)}Task: ${step.task}${contextFrom(job, index)}`;
  const steer = steerText(job);
  if (sub === 0) {
    const builder = await ask(ctx, BUILDER_SYSTEM + "\n" + LANGUAGE_RULE, brief + steer, { maxTokens: 1500 });
    job.scratch = { builder };
    step.sub = 1;
    return { done: false, posts: agentPosts(step, builder, ctx.lang, "council.builder") };
  }
  const builder = clipTrim(job.scratch.builder, 4000);
  if (sub === 1) {
    const critic = await ask(ctx, CRITIC_SYSTEM + "\n" + LANGUAGE_RULE, `${brief}\n\nBuilder's answer:\n${builder}${steer}`, { maxTokens: 900 });
    job.scratch.critic = critic;
    step.sub = 2;
    return { done: false, posts: agentPosts(step, critic, ctx.lang, "council.critic") };
  }
  const user = `${brief}\n\nBuilder:\n${builder}\n\nCritic:\n${clipTrim(job.scratch.critic, 2500)}${steer}`;
  finishStep(step, await ask(ctx, JUDGE_SYSTEM + "\n" + LANGUAGE_RULE, user, { maxTokens: 1800 }));
  return { done: true, posts: [], role: "council.judge" };
}

// GlowRoom's userContent for one crew member.
function crewUserContent(job, index) {
  const step = job.steps[index];
  if (job.kind === "ask") return `Your task: ${step.task}`;
  const prior = priorWork(job, index);
  return [
    `Overall goal: ${job.goal}`,
    job.context ? `Earlier conversation context:\n${truncate(job.context, 2000)}` : "",
    prior ? `Work done so far by teammates:\n${prior}` : "",
    `Your task: ${step.task}`,
  ].filter(Boolean).join("\n\n");
}

// The same shape for Scout when it works for GlowLead: the lead's context stands in for the crew's.
function scoutUserContent(job, index) {
  if (job.kind !== "lead") return crewUserContent(job, index);
  const earlier = clipTrim(contextFrom(job, index), 1500);
  return [
    `Overall goal: ${job.goal}`,
    earlier ? `Earlier conversation context:\n${earlier}` : "",
    `Your task: ${job.steps[index].task}`,
  ].filter(Boolean).join("\n\n");
}

// Scout: think of a query, read the web, then write from what was read. Three units.
async function scoutStep(job, index, ctx) {
  const step = job.steps[index];
  const sub = step.sub || 0;

  if (sub === 0) {
    let query = "";
    try {
      query = await ask(ctx, QUERY_HEAD + dateLine(ctx.now()) + QUERY_TAIL, step.task + "\nGoal: " + job.goal, { maxTokens: 60, temperature: 0 });
    } catch (error) {
      if (isStop(error, ctx) || isBusy(error)) throw error;
    }
    query = query.replace(/["\n]/g, " ").trim().slice(0, 120) || step.task.slice(0, 100);
    job.scratch = { query };
    step.sub = 1;
    return { done: false, posts: [] };
  }

  if (sub === 1) {
    const query = job.scratch.query || step.task.slice(0, 100);
    let results = [];
    try {
      const found = await ctx.web.search(query, ctx.signal);
      results = Array.isArray(found && found.results) ? found.results : [];
    } catch (error) {
      if (isStop(error, ctx)) throw error;
    }
    const top = results.slice(0, 3);
    const pages = await Promise.all(top.map(async (result) => {
      try {
        const page = await ctx.web.read(result.url, ctx.signal);
        return relevantExcerpt(page.text, query + " " + step.task, 3200) || result.snippet || "";
      } catch (error) {
        if (isStop(error, ctx)) throw error;
        return result.snippet || "";
      }
    }));
    const sources = results.map((result, position) => ({
      title: String(result.title || result.url),
      url: result.url,
      text: position < top.length ? pages[position] : result.snippet || "",
    }));
    job.scratch = { query, sources };
    step.sub = 2;
    return { done: false, posts: [] };
  }

  const sources = job.scratch.sources || [];
  const system = crewSystem("explore", sources.length ? SCOUT_LINES.join("\n") : SCOUT_NO_RESULTS, ctx.now());
  let user = scoutUserContent(job, index);
  if (sources.length) {
    user += "\n\nSources (fetched just now):\n" + sources
      .map((source, position) => `[${position + 1}] ${source.title} — ${source.url}\n${truncate(source.text, 3000)}`)
      .join("\n\n");
  }
  user += steerText(job);
  let answer = await ask(ctx, system, user);
  if (looksLikeLeakedReasoning(answer)) {
    try {
      answer = await ask(ctx, system + "\n" + SCOUT_RETRY_LINE, user, { temperature: 0.2 });
    } catch (error) {
      if (isStop(error, ctx)) throw error;
    }
  }
  step.sources = sources.map((source) => ({ title: source.title, url: source.url }));
  step.researchFailed = sources.length === 0;
  // The numbered list of what was really read, unless the answer already shows those addresses.
  const cited = sources.some((source) => answer.includes(source.url));
  finishStep(step, cited ? answer : answer + sourceList(step.sources));
  return { done: true, posts: [] };
}

async function crewStep(job, index, ctx, bot) {
  const step = job.steps[index];
  const system = crewSystem(bot, CREW_EXTRAS[bot] || "", ctx.now());
  finishStep(step, await ask(ctx, system, crewUserContent(job, index) + steerText(job)));
  return { done: true, posts: [] };
}

// One bounded piece of one step: { done, posts, role }.
function runStep(job, index, ctx) {
  const step = job.steps[index];
  step.status = "active";
  if (isScout(step)) return scoutStep(job, index, ctx);
  if (step.bot && Object.hasOwn(BOTS, step.bot)) return crewStep(job, index, ctx, step.bot);
  if (step.worker === "council") return councilStep(job, index, ctx);
  return chatStep(job, index, ctx);
}

// ------------------------------------------------------------------ ending a job
// Stops the job with an error message for the user. Used when nothing useful can be delivered.
export function failJob(job, message, ctx, posts = []) {
  job.status = "error";
  job.error = clipTrim(message, 400) || "Something went wrong.";
  let html = t(ctx.lang, "error", { error: job.error });
  if (job.kind === "lead" || job.kind === "room") html = t(ctx.lang, "report.failed", { error: job.error });
  if (job.kind === "spark") html = t(ctx.lang, "spark.error");
  return { posts: [...posts, { html, tag: "note" }], plan: false };
}

// GlowLead's final report: the deliverable, then the done-criteria and what the check found.
export function reportPosts(job, lang) {
  const blocks = [{ type: "text", lines: [t(lang, "report.title"), ""] }, ...mdToBlocks(job.report)];
  const tail = [];
  if (!job.simple) {
    tail.push("", "———", t(lang, "report.criteria"));
    job.criteria.forEach((criterion, index) => {
      const met = Array.isArray(job.met) ? job.met[index] : null;
      tail.push(`${met === true ? "✅" : met === false ? "❌" : "➖"} ${escapeHtml(criterion)}`);
    });
    if (job.unverified) tail.push(t(lang, "report.unverified"));
    else if (job.reviewError) tail.push(t(lang, "report.unchecked", { error: job.reviewError }));
    else if (job.missing) tail.push(t(lang, "report.missing", { missing: job.missing }));
  }
  const models = modelsLine(job, lang);
  if (models) tail.push("", models);
  if (tail.length) blocks.push({ type: "text", lines: tail });
  return packBlocks(blocks).map((html) => ({ html, tag: "final" }));
}

function deliverLead(job, review, ctx) {
  const lastOutput = job.steps.filter((step) => step.output).map((step) => step.output).pop() || "";
  job.report = clip(review.report || lastOutput, REPORT_MAX);
  // Success in a different step cannot erase research that failed and was never redone.
  job.unverified = failedResearch(job).length > 0;
  job.met = job.unverified ? job.criteria.map(() => false) : review.met;
  job.missing = job.unverified ? "" : review.missing;
  job.checked = review.checked;
  job.status = "done";
  return { posts: reportPosts(job, ctx.lang), plan: false };
}

function deliverRoom(job, markdown, ctx, noteHtml) {
  const seen = new Set();
  const sources = [];
  job.steps.forEach((step) => (step.sources || []).forEach((source) => {
    if (seen.has(source.url)) return;
    seen.add(source.url);
    sources.push(source);
  }));
  job.final = clip(markdown + sourceList(sources), REPORT_MAX);
  job.status = "done";
  const head = [t(ctx.lang, "room.final"), ""];
  if (noteHtml) head.push(noteHtml, "");
  const blocks = [{ type: "text", lines: head }, ...mdToBlocks(job.final)];
  const models = modelsLine(job, ctx.lang);
  if (models) blocks.push({ type: "text", lines: ["", models] });
  return { posts: packBlocks(blocks).map((html) => ({ html, tag: "final" })), plan: false };
}

// ------------------------------------------------------------------ GlowLead
async function planLead(job, ctx) {
  const replanning = Boolean(job.change) && job.steps.length > 0;
  let parsed = null;
  try {
    let user = `Goal: ${job.goal}${backgroundFor(job)}`;
    if (replanning) {
      const before = job.steps.map((step, index) => `${index + 1}. [${step.worker}] ${step.title}: ${step.task}`).join("\n");
      user += `\n\nThe plan you made before:\n${before}\n\nThe user wants this changed:\n${job.change}\n\nWrite the complete new plan.`;
    }
    parsed = parsePlan(await ask(ctx, planSystem(), user, { maxTokens: 900 }), job.goal);
  } catch (error) {
    if (isStop(error, ctx)) throw error;
  }
  job.planKept = replanning && !(parsed && parsed.planned);
  if (!job.planKept) {
    // The planner did not answer (busy free AI, empty reply): use a simple plan instead of giving up.
    const plan = parsed || {
      summary: "",
      criteria: ["Directly answers: " + clipTrim(job.goal, 140), "Concrete and usable, not generic"],
      steps: ensureResearch(fallbackPlan(job.goal), job.goal),
      planned: false,
    };
    job.summary = plan.summary;
    job.criteria = plan.criteria;
    job.steps = plan.steps.map((step) => ({ ...step, status: "queued", output: "" }));
    job.planned = plan.planned;
  }
  job.change = "";
  job.scratch = {};
  job.fixed = false;
  job.phase = "work";
  // One GlowChat step needs no approval and no review: the answer is the report.
  job.simple = job.steps.length === 1 && job.steps[0].worker === "chat";
  if (job.simple) return { posts: [], plan: false };
  job.status = "awaiting";
  return { posts: [], plan: true };
}

function closeLeadWork(job, ctx, posts) {
  if (nextStepIndex(job) >= 0) return { posts, plan: false };
  if (!job.steps.some((step) => step.status === "done")) {
    return failJob(job, job.steps.map((step) => step.error).filter(Boolean)[0] || NO_STEP_DONE, ctx, posts);
  }
  job.phase = "check";
  return { posts, plan: false };
}

async function workLead(job, ctx) {
  const index = nextStepIndex(job);
  if (index < 0) return closeLeadWork(job, ctx, []);
  const step = job.steps[index];
  const result = await runStep(job, index, ctx);
  if (!result.done) return { posts: result.posts, plan: false };
  job.scratch = {};
  if (job.simple) {
    job.report = clip(step.output, REPORT_MAX);
    job.status = "done";
    return { posts: reportPosts(job, ctx.lang), plan: false };
  }
  if (Number.isInteger(step.redoOf) && job.steps[step.redoOf]) job.steps[step.redoOf].redone = true;
  return closeLeadWork(job, ctx, agentPosts(step, step.output, ctx.lang, result.role));
}

// The review both writes the report and checks it against the done-criteria.
async function checkLead(job, ctx) {
  const work = job.steps
    .filter((step) => step.output)
    .map((step) => `### ${WORKERS[step.worker].name}: ${step.title}\n${clipTrim(step.output, 6000)}`)
    .join("\n\n");
  const criteria = job.criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n");
  const failed = failedResearch(job);
  const failedNote = failed.length
    ? `\n\nNOTE: live research FAILED for: ${failed.map((step) => step.title).join("; ")}. Nothing above was checked on the live web.`
    : "";
  const user = `Goal: ${job.goal}\n\nDone-criteria:\n${criteria}\n\nTeam's work:\n${work}${failedNote}${steerText(job)}`;
  const review = parseReview(await ask(ctx, REVIEW_SYSTEM + "\n" + LANGUAGE_RULE, user, { maxTokens: 3000 }), job.criteria.length);
  if (failed.length) {
    review.met = job.criteria.map(() => false);
    review.missing = RESEARCH_FAILED_MISSING;
  }
  if (review.met.some((met) => met !== true) && !job.fixed) {
    // One fix-up round: redo failed research, or hand what is missing back to GlowChat, then check again.
    job.fixed = true;
    const research = failed[0];
    job.steps.push(research ? {
      worker: "room",
      title: REDO_TITLE,
      task: `${research.task}\n\n${REDO_TAIL}${review.missing || job.criteria.join("; ")}`,
      status: "queued",
      output: "",
      fixup: true,
      redoOf: job.steps.indexOf(research),
    } : {
      worker: "chat",
      title: FIX_TITLE,
      task: `${FIX_HEAD}${review.missing || FIX_DEFAULT}${FIX_TAIL}${job.criteria.join("; ")}`,
      status: "queued",
      output: "",
      fixup: true,
    });
    job.phase = "work";
    return { posts: [], plan: false };
  }
  return deliverLead(job, review, ctx);
}

// ------------------------------------------------------------------ GlowRoom
async function planRoom(job, ctx) {
  let steps = [];
  try {
    const roster = ROOM_CREW.map((id) => `- ${id} (${BOTS[id].name}): ${SKILLS[id]}`).join("\n");
    const system = [NOVA_PLAN_HEAD, NOVA_PLAN_CREW, roster, ...NOVA_PLAN_RULES].join("\n");
    const user = job.goal + (job.context ? "\n\nContext from earlier work:\n" + truncate(job.context, 2000) : "");
    const json = extractCrewJson(await ask(ctx, system, user, { maxTokens: 600, temperature: 0.2 }));
    steps = (json && Array.isArray(json.steps) ? json.steps : [])
      .filter((step) => step && ROOM_CREW.includes(step.bot) && step.task)
      .slice(0, 4)
      .map((step) => ({ bot: step.bot, task: String(step.task).slice(0, 400) }));
  } catch (error) {
    if (isStop(error, ctx)) throw error;
  }
  job.planned = steps.length > 0;
  // The planner did not answer: Nova uses the built-in plan instead of giving up.
  if (!steps.length) steps = heuristicPlan(job.goal, ROOM_CREW);
  job.steps = steps.map((step) => ({ bot: step.bot, title: clipTrim(step.task, 80), task: step.task, status: "queued", output: "" }));
  job.scratch = {};
  job.phase = "work";
  return { posts: [], plan: false };
}

function closeRoomWork(job, ctx, posts) {
  if (nextStepIndex(job) >= 0) return { posts, plan: false };
  const done = job.steps.filter((step) => step.status === "done");
  if (!done.length) {
    return failJob(job, job.steps.map((step) => step.error).filter(Boolean)[0] || NO_STEP_DONE, ctx, posts);
  }
  if (job.steps.length === 1) {
    // One crew member did it all: its answer is the final answer, posted once.
    job.final = done[0].output;
    job.status = "done";
    return { posts: [...posts, ...soloPosts(done[0], job.final, job, ctx.lang)], plan: false };
  }
  job.phase = "final";
  return { posts, plan: false };
}

async function workRoom(job, ctx) {
  const index = nextStepIndex(job);
  if (index < 0) return closeRoomWork(job, ctx, []);
  const step = job.steps[index];
  const result = await runStep(job, index, ctx);
  if (!result.done) return { posts: result.posts, plan: false };
  job.scratch = {};
  return closeRoomWork(job, ctx, job.steps.length > 1 ? agentPosts(step, step.output, ctx.lang) : []);
}

async function finalRoom(job, ctx) {
  const system = crewSystem("leader", NOVA_FINAL_LINES.join("\n"), ctx.now());
  const user = `Goal: ${job.goal}\n\nTeam work:\n${priorWork(job, job.steps.length)}${steerText(job)}`;
  return deliverRoom(job, await ask(ctx, system, user, { maxTokens: 3000 }), ctx);
}

// ------------------------------------------------------------------ one agent, a chat turn, a tale
async function workAsk(job, ctx) {
  const step = job.steps[0];
  const result = await runStep(job, 0, ctx);
  if (!result.done) return { posts: result.posts, plan: false };
  job.scratch = {};
  job.final = step.output;
  job.status = "done";
  return { posts: soloPosts(step, step.output, job, ctx.lang, result.role), plan: false };
}

async function chatUnit(job, ctx) {
  const system = [...CHAT_SYSTEM, `Today's date: ${dateLine(ctx.now())}.`, CHAT_LANGUAGE_RULE].join("\n");
  const text = await ask(ctx, system, job.goal, { maxTokens: 1500, history: ctx.history || [] });
  job.final = clip(text, STEP_OUTPUT_MAX);
  job.status = "done";
  return { posts: mdToMessages(job.final).map((html) => ({ html, tag: "final" })), plan: false };
}

// GlowSpark writes on the Worker's own CPU: no outside model is called.
async function sparkUnit(job, ctx) {
  await ctx.spark.load(ctx.signal);
  const tale = ctx.spark.write(job.goal, { maxTokens: 260 });
  job.final = clip((job.goal + tale.text).trim(), 3000);
  job.status = "done";
  const lines = [t(ctx.lang, "spark.title"), "", ...job.final.split("\n").map((line) => escapeHtml(line)), "", `<i>${t(ctx.lang, "spark.note")}</i>`];
  const buttons = [[{ text: tPlain(ctx.lang, "btn.again"), data: `agn:${job.id}` }]];
  return { posts: [{ html: lines.join("\n"), tag: "final", buttons }], plan: false };
}

// ------------------------------------------------------------------ the unit
// Called before a unit runs, so the board can show which step is active and what Scout is doing.
export function prepareUnit(job, lang) {
  job.note = "";
  if ((job.kind !== "lead" && job.kind !== "room") || job.phase !== "work") return;
  const index = nextStepIndex(job);
  if (index < 0) return;
  const step = job.steps[index];
  step.status = "active";
  if (!isScout(step)) return;
  const sub = step.sub || 0;
  if (sub === 0) job.note = t(lang, "board.note.query");
  else if (sub === 1) job.note = t(lang, "board.note.reading", { query: job.scratch.query || "" });
  else job.note = t(lang, "board.note.writing", { n: (job.scratch.sources || []).length });
}

// Does one bounded unit of the job and returns { posts: [{ html, tag, buttons? }], plan }.
// ctx = { models: { complete }, web, spark, now, signal, lang, history }.
// It throws when the unit fails; the caller retries a busy model, or calls failUnit.
export async function runUnit(job, ctx) {
  if (job.kind === "lead") {
    if (job.phase === "plan") return planLead(job, ctx);
    if (job.phase === "check") return checkLead(job, ctx);
    return workLead(job, ctx);
  }
  if (job.kind === "room") {
    if (job.phase === "plan") return planRoom(job, ctx);
    if (job.phase === "final") return finalRoom(job, ctx);
    return workRoom(job, ctx);
  }
  if (job.kind === "ask") return workAsk(job, ctx);
  if (job.kind === "chat") return chatUnit(job, ctx);
  if (job.kind === "spark") return sparkUnit(job, ctx);
  throw new Error(`Unknown job kind: ${job.kind}`);
}

// What happens when a unit failed for good: no model is called here.
export function failUnit(job, error, ctx) {
  const message = clipTrim(errorText(error), 400) || "Something went wrong.";
  const team = job.kind === "lead" || job.kind === "room";

  if (team && job.phase === "work") {
    const index = nextStepIndex(job);
    const posts = [];
    if (index >= 0) {
      const step = job.steps[index];
      step.status = "error";
      step.error = message;
      delete step.sub;
      job.scratch = {};
      if (job.kind === "lead" && job.simple) return failJob(job, message, ctx);
      posts.push({ html: `${agentHeader(step, ctx.lang)} · ${escapeHtml(step.title)}\n${t(ctx.lang, "step.failed", { error: message })}`, tag: "agent" });
    }
    return job.kind === "lead" ? closeLeadWork(job, ctx, posts) : closeRoomWork(job, ctx, posts);
  }

  if (job.kind === "lead" && job.phase === "check") {
    // The final check could not run: deliver the team's work as it is and say it was not checked.
    const outputs = job.steps.filter((step) => step.output);
    const report = outputs.length > 1
      ? outputs.map((step) => `### ${agentOf(step).name}: ${step.title}\n\n${step.output}`).join("\n\n")
      : (outputs[0] ? outputs[0].output : "");
    job.reviewError = clipTrim(errorText(error), 120) || "AI error";
    return deliverLead(job, { report, met: job.criteria.map(() => null), checked: false, missing: "" }, ctx);
  }

  if (job.kind === "room" && job.phase === "final") {
    // Nova could not write the summary: hand over the team's own work rather than nothing.
    const work = job.steps.filter((step) => step.output).map((step) => `### ${agentOf(step).name}\n${step.output}`).join("\n\n");
    return deliverRoom(job, work, ctx, t(ctx.lang, "room.unsummarised", { error: message }));
  }

  return failJob(job, message, ctx);
}

// ------------------------------------------------------------------ what the chat shows
// The plan as its own message with Run, Change and Cancel.
export function planMessage(job, lang) {
  const lines = [t(lang, "lead.plan")];
  if (job.summary) lines.push(escapeHtml(job.summary));
  lines.push("", t(lang, "lead.done.when"));
  job.criteria.forEach((criterion) => lines.push(`• ${escapeHtml(criterion)}`));
  lines.push("", t(lang, "lead.steps"));
  job.steps.forEach((step, index) => {
    const agent = agentOf(step);
    lines.push(`${index + 1}. ${agent.icon} <b>${escapeHtml(agent.name)}</b>: ${escapeHtml(step.title)}`);
  });
  if (job.planKept) lines.push("", `<i>${t(lang, "lead.plan.kept")}</i>`);
  else if (!job.planned) lines.push("", `<i>${t(lang, "lead.plan.default")}</i>`);
  lines.push("", t(lang, "lead.plan.ask"));
  const buttons = [[
    { text: tPlain(lang, "btn.run"), data: `run:${job.id}` },
    { text: tPlain(lang, "btn.change"), data: `chg:${job.id}` },
    { text: tPlain(lang, "btn.cancel"), data: `can:${job.id}` },
  ]];
  return { html: lines.join("\n"), buttons };
}

const STEP_ICONS = { done: "✅", error: "⚠️", active: "⏳", queued: "▫️" };
const SETTLED = ["awaiting", "paused", "stopped", "done", "error"];

// The live board of a mission or a room run: one message that is edited as the work goes on.
export function boardText(job, lang) {
  const lines = [t(lang, job.kind === "room" ? "board.room" : "board.mission", { goal: clipTrim(job.goal, 300) })];
  if (SETTLED.includes(job.status)) {
    lines.push(t(lang, `board.state.${job.status}`));
  } else {
    const current = nextStepIndex(job);
    const position = job.phase === "work" && current >= 0 ? ` · ${t(lang, "board.step.of", { n: current + 1, total: job.steps.length })}` : "";
    lines.push(t(lang, `board.phase.${job.phase}`) + position);
  }
  job.steps.forEach((step) => {
    const agent = agentOf(step);
    const icon = step.redone ? "♻️" : STEP_ICONS[step.status] || STEP_ICONS.queued;
    lines.push(`${icon} ${agent.icon} ${escapeHtml(agent.name)}: ${escapeHtml(step.title)}`);
  });
  if (job.note && job.status === "active") lines.push(`<i>${job.note}</i>`);
  return lines.join("\n");
}

export function boardButtons(job, lang) {
  const stop = { text: tPlain(lang, "btn.stop"), data: `stp:${job.id}` };
  if (job.status === "active") return [[{ text: tPlain(lang, "btn.pause"), data: `pau:${job.id}` }, stop]];
  if (job.status === "paused") return [[{ text: tPlain(lang, "btn.resume"), data: `res:${job.id}` }, stop]];
  return [];
}
