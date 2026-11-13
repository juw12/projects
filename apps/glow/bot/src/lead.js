// GlowLead inside the bot: plan a goal into steps and done-criteria, hand each step to a worker,
// then check the work against the criteria and write the report.
//
// The planner, worker and checker instructions follow apps/glow/web/lead/lead.js, so a mission
// started in Telegram behaves like one started on the GlowLead page. The bot's workers are:
//   chat     GlowChat: one strong model
//   council  GlowChat Council: a Builder, a Critic and a Judge
//   room     GlowRoom crew: searches the live web, reads the pages and cites them
// (The page's browser worker, Glow Hands, needs the user's own computer, so the bot has none.)
//
// Every function here is plain: it gets `complete` (the model chain) and `web`, and returns data.
// The Durable Object decides when each part runs and keeps the mission in storage between parts.

import { clip, errorText, inBatches } from "./util.js";

export const MAX_STEPS = 4;
const CONTEXT_PER_STEP = 2500;
const PAGES_PER_RESEARCH = 3;
const CHARS_PER_PAGE = 5000;

export const WORKERS = {
  chat: { icon: "💬", name: "GlowChat" },
  council: { icon: "⚖️", name: "GlowChat Council" },
  room: { icon: "🏢", name: "GlowRoom crew" },
};

export const PLAN_SYSTEM = [
  "You are GlowLead, the lead of a team of AI apps. You never do the work yourself: you plan it, delegate it and check it.",
  "Your workers:",
  '- "chat" = GlowChat: one strong AI model. Best for explaining, writing, brainstorming, drafting and planning.',
  '- "council" = GlowChat Council: a Builder and a Critic debate, then a Judge decides. Best for decisions, trade-offs and risk reviews.',
  '- "room" = GlowRoom crew: a researcher that searches and reads the live web and cites sources. Use it ONLY when a step needs current facts, prices, news or sources.',
  `Rules: use 1 to ${MAX_STEPS} steps (fewer is better; a simple goal needs 1 step). Each task must be a complete instruction the worker can do alone.`,
  "Also write 2 to 4 done-criteria: short, concrete, checkable statements the final result must satisfy.",
  'Reply with JSON only, no other text: {"summary":"one sentence","criteria":["..."],"steps":[{"worker":"chat|council|room","title":"short title","task":"full instruction"}]}',
].join("\n");

export const REVIEW_SYSTEM = [
  "You are GlowLead, the team lead. Your team has finished the steps below.",
  "1) Write the final deliverable for the user in Markdown. Lead with the answer. Keep the team's facts, numbers and source links; remove repetition; do not describe the process.",
  "Never add facts, products, prices, ratings or links that are not in the team's work. If the team's work notes that live research FAILED, any criterion that needs current, sourced or checked facts is NOT met, and the deliverable must say the facts were not checked live.",
  "Only numbers that come from the GlowRoom crew's live research (with sources) count as checked. If no live research was done, label prices, rates, specs and other numbers as estimates to verify, and any criterion that needs current, up-to-date or sourced facts is NOT met.",
  '2) On the very last line write CHECK: followed by JSON {"met":[true or false for each done-criterion, in order],"missing":"what is still missing, or empty"}.',
].join("\n");

const HONESTY =
  "Do not invent product names, models, prices, ratings, statistics, sources or links. Use only well-known facts you are sure of, " +
  "and say plainly when something needs to be checked.";

const RESEARCH_HINT = /\b(latest|current|today|price|prices|cost|costs|compare|research|sources?|news|statistics|data|search|202\d)\b/i;
const FACTS_HINT =
  /(\bRp\.?\s?\d|\bIDR\b|\bUSD\b|\$\s?\d|\b\d+([.,]\d+)?\s?(juta|jt|ribu|rb|million|k)\b|\b(price|prices|pricing|harga|cost|costs|biaya|budget|anggaran|latest|terbaru|current|today|news|202\d)\b)/i;

// Today's date for the models: they were never told it, and goals often say "latest" or "this year".
export function today(now) {
  return new Date(now()).toISOString().slice(0, 10);
}

export function extractJson(text) {
  const cleaned = String(text || "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    return null;
  }
}

function fallbackSteps(goal) {
  if (RESEARCH_HINT.test(goal)) {
    return [
      { worker: "room", title: "Research it with the crew", task: goal },
      { worker: "chat", title: "Turn the findings into a clear answer", task: "Using the crew's findings, write the final answer to: " + goal },
    ];
  }
  return [{ worker: "chat", title: "Do it", task: goal }];
}

// Prices, budgets and "latest" facts change and must be looked up, not recalled.
function ensureResearch(steps, goal) {
  if (!FACTS_HINT.test(goal) || steps.some((step) => step.worker === "room")) return steps;
  const research = {
    worker: "room",
    title: "Check current facts and prices",
    task: `Look up the current, real facts this goal depends on (prices, specs, terms, availability) with source links: ${goal}. Report the numbers you found and say clearly what you could not confirm.`,
  };
  const withResearch = [research, ...steps];
  while (withResearch.length > MAX_STEPS) withResearch.splice(withResearch.length - 2, 1); // keep the research and the final step
  return withResearch;
}

export function parsePlan(text, goal) {
  const json = extractJson(text);
  let steps = Array.isArray(json && json.steps) ? json.steps : [];
  steps = steps
    .filter((step) => step && (step.task || step.title))
    .map((step) => ({
      worker: Object.hasOwn(WORKERS, step.worker) ? step.worker : "chat",
      title: clip(step.title || step.task, 80),
      task: clip(step.task || step.title, 1500),
    }))
    .slice(0, MAX_STEPS);
  let criteria = Array.isArray(json && json.criteria) ? json.criteria.map((item) => clip(item, 200)).filter(Boolean).slice(0, 5) : [];
  const planned = steps.length > 0;
  if (!planned) steps = fallbackSteps(goal);
  steps = ensureResearch(steps, goal);
  if (!criteria.length) criteria = ["Directly answers: " + clip(goal, 140), "Concrete and usable, not generic"];
  return { summary: clip((json && json.summary) || "", 300), criteria, steps, planned };
}

export function parseReview(text, criteriaCount) {
  const raw = String(text || "");
  const marker = raw.lastIndexOf("CHECK:");
  const report = (marker >= 0 ? raw.slice(0, marker) : raw).trim();
  const json = marker >= 0 ? extractJson(raw.slice(marker)) : null;
  const met = [];
  for (let index = 0; index < criteriaCount; index++) {
    const value = json && Array.isArray(json.met) ? json.met[index] : null;
    met.push(typeof value === "boolean" ? value : null);
  }
  const checked = !!json && Array.isArray(json.met) && json.met.length === criteriaCount && met.every((value) => typeof value === "boolean");
  return { report, met, missing: clip((json && json.missing) || "", 500), checked };
}

// What the earlier steps produced, for the next worker and for the checker.
export function contextFrom(mission, uptoIndex) {
  return mission.steps
    .slice(0, uptoIndex)
    .filter((step) => step.output)
    .map((step, index) => `### Step ${index + 1}: ${step.title} (${WORKERS[step.worker].name})\n${clip(step.output, CONTEXT_PER_STEP)}`)
    .join("\n\n");
}

function brief(mission, index) {
  const step = mission.steps[index];
  const before = contextFrom(mission, index);
  return [
    `The overall goal: ${mission.goal}`,
    before ? `What the team has done so far:\n${before}` : "",
    `Your task: ${step.task}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function ask(complete, system, content, signal, maxTokens = 2200) {
  const answer = await complete({
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    maxTokens,
    signal,
  });
  return answer;
}

// Plan a goal. Returns { summary, criteria, steps, planned, model }.
export async function planMission({ complete, goal, now, signal }) {
  const system = `${PLAN_SYSTEM}\nToday is ${today(now)}.`;
  const answer = await ask(complete, system, `Goal: ${goal}`, signal, 900);
  return { ...parsePlan(answer.text, goal), model: answer.name };
}

// Search the web, read the best pages and answer with numbered sources.
// Returns { text, sources, failed, models }. `failed` means no page or search result could be used.
export async function research({ complete, web, question, now, signal }) {
  const models = [];
  let query = clip(question.replace(/\s+/g, " "), 140);
  try {
    const picked = await ask(
      complete,
      `Write one short web search query (at most 10 words) that finds current, reliable sources for the task. Today is ${today(now)}. Reply with the query only.`,
      question,
      signal,
      60,
    );
    models.push(picked.name);
    const line = String(picked.text || "").split("\n").map((part) => part.trim()).find(Boolean) || "";
    const cleaned = line.replace(/^["'`]+|["'`]+$/g, "").replace(/^(query|search):\s*/i, "").trim();
    if (cleaned && cleaned.length <= 160) query = cleaned;
  } catch (error) {
    if (error && error.name === "StoppedError") throw error;
    // The task itself is a usable query.
  }

  const found = await web.search(query, signal);
  const hits = found.results.slice(0, 6);
  if (!hits.length) {
    return {
      text: `Live research FAILED: no search engine answered for "${query}". Nothing below was checked on the web.`,
      sources: [],
      failed: true,
      models,
      query,
    };
  }

  const pages = await inBatches(
    hits.slice(0, PAGES_PER_RESEARCH).map((hit) => async () => {
      try {
        const page = await web.read(hit.url, signal, CHARS_PER_PAGE);
        return page.text;
      } catch (error) {
        if (error && error.name === "StoppedError") throw error;
        return "";
      }
    }),
    PAGES_PER_RESEARCH,
  );
  const sources = hits.map((hit, index) => ({
    title: clip(hit.title || hit.url, 120),
    url: hit.url,
    extract: clip(pages[index] || hit.snippet || "", CHARS_PER_PAGE),
  }));
  const usable = sources.filter((source) => source.extract);
  if (!usable.length) {
    return {
      text: `Live research FAILED: the search for "${query}" found pages, but none could be read.`,
      sources: [],
      failed: true,
      models,
      query,
    };
  }

  const numbered = sources
    .map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.extract || "(could not be read)"}`)
    .join("\n\n");
  const answer = await ask(
    complete,
    [
      "You are the researcher of the GlowRoom crew. Answer the task using ONLY the numbered sources below.",
      "Cite every fact with its source number like [1]. Keep numbers, prices and dates exactly as the sources state them.",
      "If the sources do not answer something, say so plainly. Use Markdown. No preamble.",
      `Today is ${today(now)}.`,
    ].join("\n"),
    `Task: ${question}\n\nSources:\n${numbered}`,
    signal,
    1800,
  );
  models.push(answer.name);
  const list = sources.map((source, index) => `${index + 1}. [${source.title.replace(/[[\]]/g, "")}](${source.url})`).join("\n");
  return {
    text: `${answer.text.trim()}\n\n**Sources**\n${list}`,
    sources: sources.map(({ title, url }) => ({ title, url })),
    failed: false,
    models,
    query,
  };
}

// Run step `index` of a mission. Returns { output, models, failed }.
export async function runStep({ complete, web, mission, index, now, signal }) {
  const step = mission.steps[index];
  const content = brief(mission, index);
  if (step.worker === "room") {
    const found = await research({ complete, web, question: content, now, signal });
    return { output: found.text, models: found.models, failed: found.failed };
  }
  if (step.worker === "council") {
    const builder = await ask(complete, "You are the Builder in a GlowChat Council. Propose the best concrete answer to the task. Be specific. " + HONESTY, content, signal, 1500);
    const critic = await ask(
      complete,
      "You are the Critic in a GlowChat Council. Name the biggest weaknesses, risks or missing points in the Builder's answer (short bullets), then say how to fix them.",
      `${content}\n\nThe Builder's answer:\n${builder.text}`,
      signal,
      900,
    );
    const judge = await ask(
      complete,
      "You are the Judge of a GlowChat Council. Write the final answer: lead with the decision, combine the Builder's proposal with the Critic's valid points, and end with a one-line verdict. Use Markdown. " + HONESTY,
      `${content}\n\nThe Builder's answer:\n${builder.text}\n\nThe Critic's review:\n${critic.text}`,
      signal,
      1800,
    );
    return { output: judge.text, models: [builder.name, critic.name, judge.name], failed: false };
  }
  const answer = await ask(
    complete,
    `You are GlowChat, working for GlowLead (the team lead). Do the task completely and concretely. Use Markdown. No preamble. ${HONESTY} Today is ${today(now)}.`,
    content,
    signal,
  );
  return { output: answer.text, models: [answer.name], failed: false };
}

// Check the finished work. Returns { report, met, missing, checked, model }.
export async function reviewMission({ complete, mission, now, signal }) {
  const researchFailed = mission.steps.some((step) => step.worker === "room" && step.failed);
  const content = [
    `The user's goal: ${mission.goal}`,
    `Done-criteria:\n${mission.criteria.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    researchFailed ? "Note: live research FAILED in at least one step." : "",
    `The team's work:\n${contextFrom(mission, mission.steps.length)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const answer = await ask(complete, `${REVIEW_SYSTEM}\nToday is ${today(now)}.`, content, signal, 2600);
  const review = parseReview(answer.text, mission.criteria.length);
  if (researchFailed) review.met = review.met.map((value) => (value === true ? value : false));
  if (!review.report) review.report = mission.steps.map((step) => step.output).filter(Boolean).pop() || "";
  return { ...review, model: answer.name };
}

// One extra step when the check found something missing: only once, and never to paper over failed research.
export function fixUpStep(mission, review) {
  if (mission.fixedUp || !review.missing || review.met.every((value) => value === true)) return null;
  if (mission.steps.some((step) => step.worker === "room" && step.failed)) return null;
  return {
    worker: "chat",
    title: "Fill the gaps",
    task: `Improve the team's work so the final result also covers: ${review.missing}. Keep everything that was already right.`,
  };
}

export function describeError(error) {
  return clip(errorText(error), 300);
}
