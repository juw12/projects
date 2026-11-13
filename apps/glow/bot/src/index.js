// GlowBot: Glow's agents inside Telegram, running on a free Cloudflare Worker.
//
// The Worker is the front door. Telegram's updates arrive at /telegram/webhook; the Registry (one
// Durable Object) says which chat an update belongs to and who is asking; every chat then has its
// own ChatAgent (a Durable Object) that keeps the conversation and does the long work in alarms.

import { ChatLogic } from "./chat.js";
import { transcribeVoice } from "./voice.js";
import { createModels } from "./models.js";
import { runProbe } from "./probe.js";
import { LEGACY_WEBHOOK_PATH, RegistryLogic, WEBHOOK_PATH, handleRegistry, registryClient } from "./registry.js";
import { SELFTEST_NOTE, runSelfTest } from "./selftest.js";
import { createSpark } from "./spark.js";
import { createTelegram, httpTransport } from "./telegram.js";
import { INSIDE, VERSION, clip, corsHeaders, errorText, json, safeEqual, sha256Hex } from "./util.js";
import { createWeb } from "./web.js";

const PROBE_GOOD_FOR_MS = 6 * 60 * 60 * 1000;
const PROBE_GIVE_UP_MS = 10 * 60 * 1000;
const SELFTEST_RETRY_MS = 60 * 1000; // a failed self-test is run again after this long
const SIM_ID = /^[a-z0-9-]{8,64}$/; // the name of a simulated chat
const JSON_BODY = { "Content-Type": "application/json" };

function buildOf(env) {
  return String((env && env.BUILD) || "dev");
}

function pagesOf(env) {
  return String((env && env.GLOW_PAGES) || "https://juw12.github.io/projects/glow").replace(/\/+$/, "");
}

// The setup code is a long random secret only the owner has. The Worker only knows its SHA-256.
async function isSetupCode(given, env) {
  const expected = String((env && env.SETUP_CODE_SHA256) || "");
  if (!given || !expected) return false;
  return safeEqual(await sha256Hex(String(given)), expected);
}

function hasSetupCode(request, env) {
  return isSetupCode(request.headers.get("X-Glow-Setup-Code") || "", env);
}

// The JSON object a request carries, or null when it carries none.
async function bodyOf(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch (error) {
    return null;
  }
}

function objectNamed(namespace, name) {
  return namespace.get(namespace.idFromName(name));
}

function post(body) {
  return { method: "POST", headers: JSON_BODY, body: JSON.stringify(body) };
}

// Work that must not hold up the answer: Cloudflare keeps the Worker alive until it is done.
function later(ctx, work) {
  const guarded = Promise.resolve(work).catch((error) => console.log("background work failed: " + errorText(error)));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(guarded);
  return guarded;
}

// A bot connected under 0.2.0 has Telegram calling the 0.2.0 address. The Registry moves it here.
function moveWebhook(ctx, env, origin) {
  return later(
    ctx,
    registryClient(env.REGISTRY)
      .refreshWebhook(origin)
      .then((moved) => {
        if (moved && moved.ok === false) console.log(`the webhook did not move: ${moved.error} ${moved.detail || ""}`);
      }),
  );
}

// tools/connect_telegram.py and anything else written for 0.2.0 reads these names.
function inOldWords(result, origin) {
  if (!result.ok) return result;
  return {
    ...result,
    webhook: origin + WEBHOOK_PATH,
    paired: !!result.claimed,
    pairLink: result.claimed ? null : result.link,
    pairUntil: result.claimUntil || null,
  };
}

// Everything is built by one function so the tests can hand in a pretend network and a pretend clock.
export function createWorker(overrides) {
  const deps = {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    probe: runProbe,
    selftest: runSelfTest,
    every: (fn, ms) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    },
    uuid: () => crypto.randomUUID(),
    ...overrides,
  };

  // One per chat: "tg:<chat id>" for a real Telegram chat, "sim:<id>" for a simulated one. Two more
  // hold no chat at all: "sys:probe" runs the health check and "sys:selftest" the self-test.
  class ChatAgent {
    constructor(state, env) {
      this.storage = state.storage;
      this.env = env;
      this.logic = null;
    }

    // The chat itself, put together the first time it is needed.
    chat() {
      if (!this.logic) {
        const env = this.env;
        const pages = pagesOf(env);
        this.logic = new ChatLogic({
          storage: this.storage,
          now: deps.now,
          telegramFor: (config) => createTelegram({ transport: httpTransport({ fetch: deps.fetch, token: config.token }) }),
          modelsFor: (state) => createModels({ fetch: deps.fetch, ai: env.AI, now: deps.now, state }),
          web: createWeb({ fetch: deps.fetch, glowPages: pages }),
          spark: createSpark({ fetch: deps.fetch, base: `${pages}/spark`, now: deps.now }),
          registry: registryClient(env.REGISTRY),
          info: { pages, version: VERSION, build: buildOf(env) },
          every: deps.every,
          // The chat wants the words alone; transcribeVoice also says which model heard them. Telegram waits
          // on the webhook meanwhile, so each Whisper model gets 25 seconds, not the default minute.
          transcribe: async (voice, config) => {
            const heard = await transcribeVoice({ fetch: deps.fetch, ai: env.AI, token: config.token, voice, timeoutMs: 25000 });
            return heard.text;
          },
          onError: (where, error) => console.log(`chat ${where} failed: ${errorText(error)}`),
        });
      }
      return this.logic;
    }

    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;
      if (path === "/probe") return this.probe(url.searchParams.get("fresh") === "1");
      if (path === "/selftest") return this.selftest(url.searchParams.get("fresh") === "1");
      if (path === "/update" && method === "POST") return json(await this.chat().handleUpdate(await request.json()));
      if (path === "/simulate" && method === "POST") {
        return json({ ok: true, ...(await this.chat().simulate(await request.json())) });
      }
      if (path === "/simulate" && method === "GET") {
        const since = Number(url.searchParams.get("since")) || 0;
        return json({ ok: true, ...(await this.chat().transcript(since)) });
      }
      if (path === "/simulate" && method === "DELETE") {
        await this.chat().wipe();
        return json({ ok: true });
      }
      return json({ ok: false, error: "not found" }, 404);
    }

    // Always answers { running, result }: `result` is the newest finished check (it may be an old one).
    async probe(fresh) {
      const stored = await this.storage.get(["probe:run", "probe:result"]);
      const run = stored.get("probe:run");
      const result = stored.get("probe:result") || null;
      const now = deps.now();
      // A check in progress comes first, so nobody is handed the previous result as if it were new.
      if (run && now - run.requestedAt < PROBE_GIVE_UP_MS) return json({ running: true, result });
      const current = !!result && result.build === buildOf(this.env) && now - result.at < PROBE_GOOD_FOR_MS;
      if (current && !fresh) return json({ running: false, result });
      await this.storage.put("probe:run", { requestedAt: now });
      await this.storage.setAlarm(now);
      return json({ running: true, result });
    }

    // The bot's own logic, driven through whole conversations with scripted models: no network, so
    // it is quick enough to run right here. A pass is kept until the next deploy; a failure is
    // tried again after a minute. Answers in the same shape as the health check.
    async selftest(fresh) {
      const build = buildOf(this.env);
      const saved = (await this.storage.get("selftest:result")) || null;
      const started = deps.now();
      const current = !!saved && saved.build === build && saved.version === VERSION;
      const settled = current && (saved.ok === true || started - saved.at < SELFTEST_RETRY_MS);
      if (settled && !fresh) return json({ running: false, result: saved });
      let result;
      try {
        result = await deps.selftest({ info: { pages: pagesOf(this.env), version: VERSION, build } });
      } catch (error) {
        result = { ok: false, kind: "logic", note: SELFTEST_NOTE, checks: [], error: clip(errorText(error), 300) };
      }
      const finished = deps.now();
      result = { ...result, at: finished, ms: finished - started, version: VERSION, build };
      await this.storage.put("selftest:result", result);
      return json({ running: false, result });
    }

    // Never throws: a failed alarm would be retried by Cloudflare and run the whole thing again.
    async alarm() {
      let run = null;
      try {
        run = await this.storage.get("probe:run");
      } catch (error) {
        run = null; // the chat's own step below meets the same trouble and reports it
      }
      if (run) await this.finishProbe(run);
      else await this.chatStep();
    }

    async finishProbe(run) {
      try {
        const started = deps.now();
        let result;
        try {
          result = await deps.probe({
            fetch: deps.fetch,
            ai: this.env.AI,
            now: deps.now,
            glowPages: this.env.GLOW_PAGES,
          });
        } catch (error) {
          result = { at: started, ms: deps.now() - started, error: clip(errorText(error), 300) };
        }
        result.alarm = { delayMs: Math.max(0, started - run.requestedAt) };
        result.version = VERSION;
        result.build = buildOf(this.env);
        await this.storage.put("probe:result", result);
        await this.storage.delete("probe:run");
      } catch (error) {
        console.log("health check failed to finish: " + errorText(error));
      }
    }

    // A chat's alarm: the next step of its job, a post that had to wait, or the daily news. The
    // step sets its own watchdog alarm before it starts, so a failure here needs no second one.
    async chatStep() {
      try {
        await this.chat().tick();
      } catch (error) {
        console.log("chat alarm failed: " + errorText(error));
      }
    }
  }

  // The one place that knows the bot's token, its owner and which chats may use it.
  class Registry {
    constructor(state, env) {
      this.logic = new RegistryLogic({ storage: state.storage, fetch: deps.fetch, now: deps.now, pages: pagesOf(env) });
    }

    fetch(request) {
      return handleRegistry(this.logic, request);
    }
  }

  // Telegram calls this for every message, button tap and membership change.
  async function webhook(request, env, cors, origin, ctx) {
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!secret) return json({ ok: false, error: "refused" }, 403, cors);
    const update = await bodyOf(request);
    if (!update) return json({ ok: false, error: "bad request" }, 400, cors);

    // If the Registry itself fails, the error answer below makes Telegram send the update again.
    const gate = await registryClient(env.REGISTRY).gate(secret, update, origin);
    if (!gate.ok) return json({ ok: false, error: "refused" }, 403, cors);
    if (gate.legacy) moveWebhook(ctx, env, origin);
    if (gate.duplicate || gate.ignore) return json({ ok: true }, 200, cors);

    // From here the update counts as delivered: sending it twice would run the same command twice.
    try {
      const chat = objectNamed(env.CHAT, "tg:" + gate.chatId);
      const reply = await chat.fetch(INSIDE + "/update", post({ update, config: gate.config, access: gate.access }));
      if (!reply.ok) console.log(`update ${update.update_id} was answered with HTTP ${reply.status}`);
    } catch (error) {
      console.log(`update ${update.update_id} failed: ${errorText(error)}`);
    }
    return json({ ok: true }, 200, cors);
  }

  // The owner pastes the token from BotFather on the Glow page, which sends it here once.
  // Without a token the saved one is used again; newPairing forgets the owner and makes a new link.
  // "/v1/setup" is the 0.2.0 address of the same thing, answered with the 0.2.0 names added.
  async function setup(request, env, cors, origin, oldWords) {
    const body = (await bodyOf(request)) || {};
    const code = body.code || request.headers.get("X-Glow-Setup-Code") || "";
    if (!(await isSetupCode(code, env))) return json({ ok: false, error: "setup-code" }, 403, cors);
    const result = await registryClient(env.REGISTRY).setup(body.token, origin, { newPairing: body.newPairing === true });
    return json(oldWords ? inOldWords(result, origin) : result, result.ok ? 200 : 400, cors);
  }

  // A pretend chat for trying the bot without Telegram: the same code and the real AI models, but
  // every Telegram call is written down instead of sent. Owner only.
  async function simulate(request, env, cors, url) {
    if (!(await hasSetupCode(request, env))) return json({ ok: false, error: "setup-code" }, 403, cors);
    if (request.method === "POST") {
      const body = await bodyOf(request);
      if (!body) return json({ ok: false, error: "bad request" }, 400, cors);
      const { id: given, ...input } = body;
      const id = SIM_ID.test(String(given || "")) ? String(given) : deps.uuid();
      const reply = await objectNamed(env.CHAT, "sim:" + id).fetch(INSIDE + "/simulate", post(input));
      return json({ id, ...(await reply.json()) }, reply.status, cors);
    }
    if (request.method === "GET" || request.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!SIM_ID.test(id)) return json({ ok: false, error: "id" }, 400, cors);
      const since = Number(url.searchParams.get("since")) || 0;
      const reply = await objectNamed(env.CHAT, "sim:" + id).fetch(`${INSIDE}/simulate?since=${since}`, { method: request.method });
      return json({ id, ...(await reply.json()) }, reply.status, cors);
    }
    return json({ ok: false, error: "not found" }, 404, cors);
  }

  async function route(request, env, cors, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (method === "GET" && path === "/") {
      return new Response(`GlowBot ${VERSION} is running. Glow lives at ${pagesOf(env)}/\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...cors },
      });
    }

    // Telegram keeps calling the 0.2.0 address until the webhook has moved, so both are answered.
    if (method === "POST" && (path === WEBHOOK_PATH || path === LEGACY_WEBHOOK_PATH)) {
      return webhook(request, env, cors, url.origin, ctx);
    }

    if (method === "GET" && path === "/v1/status") {
      const registry = await registryClient(env.REGISTRY).status();
      // The deploy asks for the status right after it goes live, which is what starts the move.
      if (registry.legacy) moveWebhook(ctx, env, url.origin);
      return json(
        {
          ok: true,
          service: "glow-bot",
          version: VERSION,
          build: buildOf(env),
          stage: "bot",
          configured: !!registry.configured,
          bot: registry.bot || null,
          access: registry.access === "public" ? "public" : "private",
          claimed: !!registry.claimed,
          paired: !!registry.claimed, // the 0.2.0 name for "claimed"
          ...(registry.legacy ? { webhook: "moving" } : {}),
          ai: !!env.AI,
          colo: (request.cf && request.cf.colo) || "",
        },
        200,
        cors,
      );
    }

    if (method === "GET" && (path === "/v1/probe" || path === "/v1/selftest")) {
      const fresh = url.searchParams.get("fresh") === "1";
      if (fresh && !(await hasSetupCode(request, env))) {
        return json({ ok: false, error: "A fresh check needs the setup code." }, 403, cors);
      }
      const name = path === "/v1/probe" ? "probe" : "selftest";
      const reply = await objectNamed(env.CHAT, "sys:" + name).fetch(`${INSIDE}/${name}${fresh ? "?fresh=1" : ""}`);
      return json(await reply.json(), reply.status, cors);
    }

    if (method === "POST" && path === "/setup") return setup(request, env, cors, url.origin, false);
    if (method === "POST" && path === "/v1/setup") return setup(request, env, cors, url.origin, true);
    if (path === "/admin/simulate") return simulate(request, env, cors, url);

    if (method === "POST" && path === "/admin/reset") {
      if (!(await hasSetupCode(request, env))) return json({ ok: false, error: "setup-code" }, 403, cors);
      return json(await registryClient(env.REGISTRY).reset(), 200, cors);
    }

    return json({ ok: false, error: "not found" }, 404, cors);
  }

  const worker = {
    async fetch(request, env, ctx) {
      const cors = corsHeaders(request, env);
      try {
        return await route(request, env, cors, ctx);
      } catch (error) {
        return json({ ok: false, error: clip(errorText(error), 300) }, 500, cors);
      }
    },
  };

  return { worker, ChatAgent, Registry };
}

const production = createWorker();

export const ChatAgent = production.ChatAgent;
export const Registry = production.Registry;
export default production.worker;
