// The free language models GlowBot can ask, and the order it asks them in.
//
// Two kinds of model:
//   keyless     open HTTP endpoints that need no key and no account (the same ones the Glow web apps use)
//   Workers AI  Cloudflare's own models, reached through this Worker's AI binding (free daily allowance)
//
// Whoever answered last is asked first, so one job stays on one model. A provider that fails rests for a
// while, so a slow or rate-limited one is not asked again on every step.

import * as kitModule from "../../web/shared/glow-harness-kit.js";
import { StoppedError, clip, errorText, withTimeout } from "./util.js";

const Kit = globalThis.GlowHarnessKit || kitModule.default || kitModule;

function fromKit(id) {
  const found = Kit.PROVIDERS.find((provider) => provider.id === id);
  if (!found) throw new Error(`glow-harness-kit.js no longer lists the provider "${id}"`);
  return found;
}

const OVH = fromKit("ovh");
const onOvh = (id, model, name) => ({ id, kind: "http", label: OVH.label, url: OVH.url, model, name });

// The URLs come from the kit the web apps use, so the bot and the pages never drift apart.
export const KEYLESS = [
  onOvh("ovh", OVH.model, "Llama 3.3 70B"),
  onOvh("ovh-gpt-oss", "gpt-oss-120b", "gpt-oss-120b"),
  onOvh("ovh-qwen", "Qwen3.5-397B-A17B", "Qwen3.5 397B"),
  onOvh("ovh-mistral", "Mistral-Small-3.2-24B-Instruct-2506", "Mistral Small 3.2"),
  { ...fromKit("llm7"), kind: "http", name: "LLM7" },
];
// Pollinations is on the web apps' list but answered 402 (payment required) to every check made from
// Cloudflare, so the bot does not ask it.

const onWorkersAi = (id, model, name) => ({ id: "ai-" + id, kind: "ai", label: "Workers AI", model, name, shape: "messages" });

export const AI_MODELS = [
  onWorkersAi("gpt-oss-120b", "@cf/openai/gpt-oss-120b", "gpt-oss-120b"),
  onWorkersAi("llama-70b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "Llama 3.3 70B"),
  onWorkersAi("llama-4-scout", "@cf/meta/llama-4-scout-17b-16e-instruct", "Llama 4 Scout"),
  onWorkersAi("qwen3-30b", "@cf/qwen/qwen3-30b-a3b-fp8", "Qwen3 30B"),
  onWorkersAi("mistral-small", "@cf/mistralai/mistral-small-3.1-24b-instruct", "Mistral Small 3.1"),
  onWorkersAi("gpt-oss-20b", "@cf/openai/gpt-oss-20b", "gpt-oss-20b"),
  onWorkersAi("llama-8b", "@cf/meta/llama-3.1-8b-instruct-fast", "Llama 3.1 8B"),
  onWorkersAi("granite-micro", "@cf/ibm-granite/granite-4.0-h-micro", "Granite 4.0 micro"),
];
// Gemma 3 12B is left out: it refused the chat form in the live check (Workers AI error 5018).

// How a request is written for Workers AI. Every model documents the chat form; the second form is the
// one OpenAI's newer API uses, kept so the health check can tell which one a model really accepts.
export const AI_SHAPES = {
  messages: (request) => ({
    messages: request.messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
  }),
  responses: (request) => ({
    input: request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
    instructions:
      request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n") || undefined,
    max_output_tokens: request.maxTokens,
    temperature: request.temperature,
  }),
};

export class ProviderError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ProviderError";
    this.status = 0;
    this.retryAfterMs = 0;
    this.quota = false;
    this.empty = false;
    Object.assign(this, details);
  }
}

export class ModelsBusyError extends Error {
  constructor(failures, retryInMs) {
    super(`No free model answered (${failures.join("; ") || "nothing to ask"})`);
    this.name = "ModelsBusyError";
    this.failures = failures;
    this.retryInMs = retryInMs;
  }
}

const REST = {
  rateLimited: 60 * 1000, // when the provider gives no "retry after"
  longest: 10 * 60 * 1000,
  afterTimeout: 2 * 60 * 1000,
  afterError: 20 * 1000,
  aiQuota: 30 * 60 * 1000,
};

const WAIT_UNITS = [
  ["milliseconds", 1],
  ["ms", 1],
  ["seconds", 1000],
  ["secs", 1000],
  ["sec", 1000],
  ["s", 1000],
  ["minutes", 60000],
  ["mins", 60000],
  ["min", 60000],
  ["m", 60000],
];
const WAIT_PATTERN = new RegExp(
  "(?:retry|try again)\\s+(?:after|in)\\s+(\\d+(?:\\.\\d+)?)\\s*(" + WAIT_UNITS.map(([unit]) => unit).join("|") + ")?",
  "i",
);

// How long a provider asked us to wait: the Retry-After header (seconds), or "Retry after 28 s" in the body.
export function retryAfterMs(header, body) {
  const seconds = Number(header);
  if (header !== null && header !== undefined && String(header).trim() !== "" && Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const match = String(body || "").match(WAIT_PATTERN);
  if (!match) return 0;
  const unit = (match[2] || "s").toLowerCase();
  const factor = (WAIT_UNITS.find(([name]) => name === unit) || ["s", 1000])[1];
  return Math.round(Number(match[1]) * factor);
}

// Thinking models sometimes put their reasoning in <think> tags. Only the answer is kept.
export function stripThinking(text) {
  let value = String(text == null ? "" : text).replace(/<think>[\s\S]*?<\/think>/gi, "");
  const closing = /<\/think>/gi;
  let answerStart = -1;
  let match;
  while ((match = closing.exec(value))) answerStart = match.index + match[0].length;
  if (answerStart !== -1) value = value.slice(answerStart); // a closing tag alone: the answer follows it
  const opening = value.search(/<think>/i);
  if (opening !== -1) value = value.slice(0, opening); // never closed: the rest is thinking
  return value.trim();
}

// Workers AI models do not all answer in the same field. Returns { text, field, channel }.
export function readAiOutput(output) {
  if (typeof output === "string") return { text: output, field: "string", channel: "" };
  if (!output || typeof output !== "object") return { text: "", field: "", channel: "" };
  if (typeof output.response === "string" && output.response.trim()) {
    return { text: output.response, field: "response", channel: "" };
  }
  if (typeof output.output_text === "string" && output.output_text.trim()) {
    return { text: output.output_text, field: "output_text", channel: "" };
  }
  const choice = Array.isArray(output.choices) ? output.choices[0] : null;
  if (choice) {
    const read = Kit.readChoice(choice);
    if (read) return { text: read.text, field: "choices", channel: read.channel || "" };
    if (typeof choice.text === "string" && choice.text.trim()) return { text: choice.text, field: "choices.text", channel: "" };
  }
  if (Array.isArray(output.output)) {
    const parts = [];
    for (const item of output.output) {
      if (!item || item.type === "reasoning") continue;
      if (typeof item.content === "string") parts.push(item.content);
      else if (Array.isArray(item.content)) {
        for (const piece of item.content) {
          if (piece && typeof piece.text === "string" && piece.type !== "reasoning_text") parts.push(piece.text);
        }
      }
    }
    if (parts.join("").trim()) return { text: parts.join(""), field: "output", channel: "" };
  }
  if (output.result && typeof output.result === "object") return readAiOutput(output.result);
  return { text: "", field: "", channel: "" };
}

export function isQuotaError(error) {
  return /\b(?:4006|3036)\b|daily free allocation|neurons/i.test(errorText(error));
}

function fieldNames(value) {
  return value && typeof value === "object" ? Object.keys(value).slice(0, 8).join(", ") : typeof value;
}

async function askHttp(entry, request, options) {
  const body = JSON.stringify({
    model: entry.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    stream: false,
  });
  // The body is read inside the time limit too: a reply can start and then stall.
  const reply = await withTimeout(
    async (signal) => {
      const response = await options.fetch(entry.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      return {
        ok: response.ok,
        status: response.status,
        retryAfter: response.headers.get("Retry-After"),
        raw: await response.text(),
      };
    },
    options.timeoutMs,
    entry.label,
    options.signal,
  );
  if (!reply.ok) {
    throw new ProviderError(`HTTP ${reply.status}${reply.raw ? " " + clip(reply.raw.replace(/\s+/g, " "), 120) : ""}`, {
      status: reply.status,
      retryAfterMs: retryAfterMs(reply.retryAfter, reply.raw),
    });
  }
  let data = null;
  try {
    data = JSON.parse(reply.raw);
  } catch (error) {
    throw new ProviderError("the reply was not JSON", { status: reply.status });
  }
  const read = Kit.readChoice(data && data.choices && data.choices[0]);
  const text = read ? (read.channel ? read.text : stripThinking(read.text)) : "";
  if (!text) throw new ProviderError("empty reply", { status: reply.status, empty: true });
  return {
    text,
    model: String((data && data.model) || entry.model),
    channel: (read && read.channel) || "",
    status: reply.status,
    shape: "",
    field: "",
  };
}

async function askAi(entry, request, options) {
  if (!options.ai) throw new ProviderError("Workers AI is not connected to this Worker");
  const shapes = options.shapes || [entry.shape || "messages"];
  const problems = []; // one per request form tried, in the same order as `shapes`
  let details = {};
  for (const shape of shapes) {
    let output;
    try {
      output = await withTimeout(
        () => options.ai.run(entry.model, AI_SHAPES[shape](request)),
        options.timeoutMs,
        entry.label,
        options.signal,
      );
    } catch (error) {
      if (error instanceof StoppedError || error.name === "TimeoutError") throw error;
      if (isQuotaError(error)) throw new ProviderError(errorText(error), { quota: true });
      problems.push(errorText(error));
      details = { shape };
      continue;
    }
    const read = readAiOutput(output);
    const text = read.channel ? read.text : stripThinking(read.text);
    if (text) return { text, model: entry.model, channel: read.channel, status: 200, shape, field: read.field };
    problems.push(`empty reply (fields: ${fieldNames(output)})`);
    details = { empty: true, shape };
  }
  if (!problems.length) throw new ProviderError("no request form to try");
  const message =
    shapes.length > 1 ? problems.map((problem, index) => `${shapes[index]}: ${problem}`).join(" | ") : problems[0];
  throw new ProviderError(message, details);
}

// Ask one model once. request = { messages, temperature, maxTokens }; options = { fetch, ai, timeoutMs, signal, shapes }.
export function askEntry(entry, request, options) {
  return entry.kind === "ai" ? askAi(entry, request, options) : askHttp(entry, request, options);
}

function restAfter(error) {
  if (error && error.quota) return REST.aiQuota;
  if (error && (error.status === 429 || error.status === 402)) {
    return Math.min(REST.longest, Math.max(1000, error.retryAfterMs || REST.rateLimited));
  }
  if (error && error.name === "TimeoutError") return REST.afterTimeout;
  return REST.afterError;
}

export function nameOf(entry) {
  return `${entry.label} ${entry.name || entry.model}`;
}

// createModels({ fetch, ai, now, providers, aiModels, order, state, timeouts })
//   order   "keyless-first" (default) or "ai-first"
//   state   { preferred, cooldown } kept by the caller between requests (it is plain JSON)
export function createModels(options) {
  const settings = options || {};
  const send = settings.fetch || ((input, init) => fetch(input, init));
  const now = settings.now || (() => Date.now());
  const state = settings.state || {};
  if (!state.cooldown) state.cooldown = {};
  const timeouts = { http: 45000, ai: 60000, total: 150000, ...settings.timeouts };
  const keyless = settings.providers || KEYLESS;
  const aiEntries = settings.ai ? settings.aiModels || AI_MODELS : [];
  const base = settings.order === "ai-first" ? aiEntries.concat(keyless) : keyless.concat(aiEntries);

  // The model the person chose (/models) is asked first, then the one that answered last, then the rest.
  function chain() {
    const lead = [];
    for (const id of [state.pinned, state.preferred]) {
      const entry = base.find((candidate) => candidate.id === id);
      if (entry && !lead.includes(entry)) lead.push(entry);
    }
    return lead.concat(base.filter((entry) => !lead.includes(entry)));
  }

  function restingMs(entry) {
    const until = state.cooldown[entry.id] || 0;
    if (until > now()) return until - now();
    delete state.cooldown[entry.id];
    return 0;
  }

  async function complete(request) {
    const ask = {
      messages: request.messages,
      temperature: request.temperature === undefined ? 0.4 : request.temperature,
      maxTokens: request.maxTokens || 2200,
    };
    const signal = request.signal;
    const started = now();
    const failures = [];
    let retryAt = Infinity;
    for (const entry of chain()) {
      if (signal && signal.aborted) throw new StoppedError();
      const resting = restingMs(entry);
      if (resting > 0) {
        retryAt = Math.min(retryAt, now() + resting);
        failures.push(`${nameOf(entry)}: resting ${Math.ceil(resting / 1000)} s`);
        continue;
      }
      const left = timeouts.total - (now() - started);
      if (left < 5000) {
        retryAt = Math.min(retryAt, now());
        failures.push("out of time for this step");
        break;
      }
      try {
        const answer = await askEntry(entry, ask, {
          fetch: send,
          ai: settings.ai,
          signal,
          timeoutMs: Math.min(left, entry.kind === "ai" ? timeouts.ai : timeouts.http),
        });
        state.preferred = entry.id;
        return {
          text: answer.text,
          channel: answer.channel,
          provider: entry.id,
          label: entry.label,
          name: entry.name || entry.model,
          model: answer.model,
          ms: now() - started,
          failures,
        };
      } catch (error) {
        if (error instanceof StoppedError || (signal && signal.aborted)) throw new StoppedError();
        const rest = restAfter(error);
        const resters = error && error.quota ? aiEntries : [entry];
        for (const rester of resters) state.cooldown[rester.id] = now() + rest;
        retryAt = Math.min(retryAt, now() + rest);
        failures.push(`${nameOf(entry)}: ${clip(errorText(error), 140)}`);
      }
    }
    throw new ModelsBusyError(failures, retryAt === Infinity ? 30000 : Math.max(1000, retryAt - now()));
  }

  // For the status page: every model in asking order, and how long each is resting.
  function describe() {
    return chain().map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      name: entry.name || entry.model,
      model: entry.model,
      restingMs: restingMs(entry),
    }));
  }

  return { complete, describe, chain, state };
}
