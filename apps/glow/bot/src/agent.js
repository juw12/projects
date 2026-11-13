// GlowBot's /agent mode: GlowHarness, the tool-using loop from the Glow web app, inside a Telegram chat.
//
// The loop and the tools are the web app's own files (glow-harness.js and glow-harness-kit.js). This
// module adds what a chat on a server needs:
//   - two more tools, search and read, so the agent can look things up on the live web
//   - notes kept per chat instead of per device
//   - a journal, so one run can be spread over several short alarms and can wait for the user's tap
//
// The journal holds, in order, every model reply, every yes or no from the user and every tool result
// of the run so far. Each alarm starts the loop again from the top and answers from the journal until
// the journal runs out, and only then does live work. The loop is deterministic, so it rebuilds the
// same conversation each time and an approved action never runs twice.

import * as engineModule from "../../web/shared/glow-harness.js";
import * as kitModule from "../../web/shared/glow-harness-kit.js";
import { relevantExcerpt, truncate } from "./crew-port.js";
import { dateLine, modelsLine } from "./missions.js";
import { t } from "./strings.js";
import { mdToBlocks, packBlocks } from "./telegram.js";
import { StoppedError, clip, errorText, withTimeout } from "./util.js";

const Engine = globalThis.GlowHarness || engineModule.default || engineModule;
const Kit = globalThis.GlowHarnessKit || kitModule.default || kitModule;

// One alarm makes at most this many live model calls. A call can take a minute when the free models
// are slow, and one alarm must stay well inside its time and request limits.
export const LIVE_CALLS_PER_TICK = 2;
export const MAX_STEPS = 8;
const TOOL_TIMEOUT_MS = 40000;
const RESULT_MAX = 6000;
const ANSWER_MAX = 12000;
const EXCERPT_MAX = 2400;
const SUMMARY_MAX = 600;
const KIT_TOOLS = ["calc", "text", "clock", "units", "notes"];

const SYSTEM_LINES = [
  "You are working inside a Telegram chat, for the person who wrote the task.",
  "You can search the live web and read pages. Never invent facts, prices, sources or links: look them up, or say plainly that you could not.",
  "Write the FINAL answer in the language the task was written in, in Markdown, short enough to read on a phone. Name the pages you used.",
];

function searchTool(ctx) {
  return {
    name: "search",
    aliases: ["web", "websearch", "web_search", "google", "bing"],
    description: "Search the live web. Returns up to six results, each with a title, an address and a short snippet. Use it for anything current: prices, news, dates, or a fact you are not sure of.",
    hint: "A search result is only a snippet. When the snippet does not hold the answer, read the page.",
    params: { query: { type: "string", required: true, aliases: ["q", "text", "question", "keywords", "term"] } },
    examples: [{ query: "Raspberry Pi 5 8GB price" }],
    risk: () => "read",
    untrusted: true,
    run: async (args, context) => {
      const found = await ctx.web.search(String(args.query), context && context.signal);
      const results = Array.isArray(found && found.results) ? found.results : [];
      if (!results.length) return "No results. Try different words.";
      return results
        .map((result, index) => `${index + 1}. ${result.title || result.url} — ${result.url}\n   ${truncate(String(result.snippet || ""), 240)}`)
        .join("\n");
    },
  };
}

function readTool(ctx, task) {
  return {
    name: "read",
    aliases: ["open", "fetch", "browse", "visit", "page"],
    description: "Open one web page and return the part of its text that matters. Give the full address, and say what you are looking for.",
    params: {
      url: { type: "string", required: true, aliases: ["address", "link", "href", "uri"] },
      about: { type: "string", aliases: ["question", "query", "topic", "find"] },
    },
    examples: [{ url: "https://en.wikipedia.org/wiki/Raspberry_Pi", about: "Raspberry Pi 5 release date" }],
    risk: () => "read",
    untrusted: true,
    run: async (args, context) => {
      const page = await ctx.web.read(String(args.url), context && context.signal);
      const text = String((page && page.text) || "");
      const excerpt = relevantExcerpt(text, `${args.about || ""} ${task}`, EXCERPT_MAX) || text.slice(0, EXCERPT_MAX);
      if (!excerpt.trim()) throw new Error("the page had no readable text");
      return excerpt;
    },
  };
}

// The tools of one run. The notes tool reads and writes the given storage.
export function agentTools(ctx, storage, task) {
  const fromKit = Kit.createTools({ storage, now: ctx.now, offsetMinutes: 420 })
    .filter((tool) => KIT_TOOLS.includes(tool.name))
    .map((tool) => (tool.name === "notes" ? { ...tool, description: tool.description.replace("kept on this device", "kept for this chat") } : tool));
  return [...fromKit, searchTool(ctx), readTool(ctx, task)];
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.text === "string") return value.text;
  return JSON.stringify(value);
}

function finishAgent(job, result, ctx) {
  const lang = ctx.lang;
  const models = modelsLine(job, lang);
  const answer = clip(String(result.answer || "").trim(), ANSWER_MAX);

  if ((result.status === "done" && answer) || result.status === "limit") {
    job.status = "done";
    job.final = answer;
    const head = [t(lang, "harness.title"), ""];
    if (result.status === "limit") head.push(t(lang, "harness.limit"), "");
    const tail = ["", `<i>${t(lang, "harness.steps", { n: result.toolCalls })}</i>`];
    if (models) tail.push(models);
    const blocks = [{ type: "text", lines: head }, ...mdToBlocks(answer), { type: "text", lines: tail }];
    return { posts: packBlocks(blocks).map((html) => ({ html, tag: "final" })), plan: false };
  }

  const reason = result.status === "loop"
    ? "it kept repeating the same step"
    : result.status === "done"
      ? "The AI returned an empty answer."
      : result.message || "the run could not be finished";
  job.status = "error";
  job.error = clip(reason, 400);
  const blocks = [{ type: "text", lines: [t(lang, "error", { error: job.error })] }];
  if (answer) blocks.push({ type: "text", lines: [""] }, ...mdToBlocks(answer));
  return { posts: packBlocks(blocks).map((html) => ({ html, tag: "note" })), plan: false };
}

// Does one alarm's worth of an /agent job.
// ctx = { models: { complete }, web, now, signal, lang, notes: { text } }.
// Returns { posts, plan: false } like a mission unit, plus one of:
//   ask   the action that needs the user's yes (job.status is "awaiting", job.pending holds it)
//   more  true when the run is not finished and the next alarm should go on
// It throws StoppedError when stopped and the models' busy error when no model answered. The journal
// keeps what was already done either way.
export async function runAgent(job, ctx) {
  if (ctx.signal && ctx.signal.aborted) throw new StoppedError();
  if (!job.journal) job.journal = { replies: [], decisions: [], results: [] };
  const journal = job.journal;
  const cursor = { reply: 0, decision: 0, result: 0 };

  const own = new AbortController();
  const onOuterAbort = () => own.abort();
  if (ctx.signal) ctx.signal.addEventListener("abort", onOuterAbort, { once: true });

  let liveCalls = 0;
  let more = false;
  let pending = null;
  let failure = null;

  const brain = {
    last: null,
    async next(request) {
      if (cursor.reply < journal.replies.length) {
        const saved = journal.replies[cursor.reply++];
        return { text: saved.text, via: saved.via };
      }
      if (liveCalls >= LIVE_CALLS_PER_TICK) {
        more = true;
        own.abort();
        throw new StoppedError();
      }
      liveCalls++;
      let answer;
      try {
        answer = await ctx.models.complete({ messages: request.messages, temperature: 0, maxTokens: 700, signal: own.signal });
      } catch (error) {
        // Leave the loop at once and hand the error to the caller, which knows how to retry.
        if (!(error instanceof StoppedError)) failure = error;
        own.abort();
        throw error;
      }
      const reply = { text: String((answer && answer.text) || ""), via: String((answer && answer.name) || "") };
      journal.replies.push(reply);
      cursor.reply++;
      return reply;
    },
  };

  // The loop asks before anything that is not a plain read. Nobody can answer inside an alarm, so the
  // question is kept, the loop is stopped, and the next alarm finds the answer in the journal.
  const confirm = (request) => {
    if (cursor.decision < journal.decisions.length) return journal.decisions[cursor.decision++];
    pending = {
      tool: request.tool,
      args: request.args,
      risk: request.risk,
      summary: clip(request.summary || `${request.tool} ${JSON.stringify(request.args)}`, SUMMARY_MAX),
      // True when the run read web pages or saved notes before asking: that text could be steering it.
      tainted: !!request.tainted,
      n: cursor.decision,
    };
    own.abort();
    return "deny";
  };

  const journaled = (tool) => ({
    ...tool,
    run: async (args) => {
      if (cursor.result < journal.results.length) {
        const saved = journal.results[cursor.result++];
        if (typeof saved.error === "string") throw new Error(saved.error);
        return saved.value;
      }
      let text;
      try {
        const value = await withTimeout((signal) => tool.run(args, { signal }), TOOL_TIMEOUT_MS, tool.name, own.signal);
        text = clip(textOf(value), RESULT_MAX);
      } catch (error) {
        if (error instanceof StoppedError || own.signal.aborted) throw error;
        journal.results.push({ error: errorText(error) });
        cursor.result++;
        throw error;
      }
      journal.results.push({ value: text });
      cursor.result++;
      return text;
    },
  });

  const storage = Kit.memoryStorage();
  if (ctx.notes && ctx.notes.text) storage.setItem(Kit.NOTES_KEY, ctx.notes.text);

  let result;
  try {
    const harness = Engine.createHarness({
      brain,
      confirm,
      tools: agentTools(ctx, storage, job.goal).map(journaled),
      system: [SYSTEM_LINES[0], `Today's date: ${dateLine(ctx.now())}.`, ...SYSTEM_LINES.slice(1)].join("\n"),
      now: ctx.now,
      maxSteps: MAX_STEPS,
      toolTimeoutMs: TOOL_TIMEOUT_MS + 5000,
      totalTimeMs: 600000,
      observationChars: 2500,
      contextChars: 24000,
    });
    result = await harness.run(job.goal, { signal: own.signal });
  } finally {
    if (ctx.signal) ctx.signal.removeEventListener("abort", onOuterAbort);
    if (ctx.notes) ctx.notes.text = storage.getItem(Kit.NOTES_KEY) || "";
  }

  if (ctx.signal && ctx.signal.aborted) throw new StoppedError();
  if (failure) throw failure;
  if (pending) {
    job.pending = pending;
    job.status = "awaiting";
    return { posts: [], plan: false, ask: pending };
  }
  if (more) return { posts: [], plan: false, more: true };
  if (result.status === "stopped") throw new Error("the run stopped before it finished");
  return finishAgent(job, result, ctx);
}
