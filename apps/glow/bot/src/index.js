// GlowBot: Glow's agents inside Telegram, running on a free Cloudflare Worker.
//
// This first version is the foundation only. It answers "are you alive?" (/v1/status) and runs the
// health check (/v1/probe) inside a Durable Object alarm, which is exactly where the bot's missions
// will run. The Telegram side arrives with the next version.

import { runProbe } from "./probe.js";
import { VERSION, clip, corsHeaders, errorText, json, safeEqual, sha256Hex } from "./util.js";

const PROBE_GOOD_FOR_MS = 6 * 60 * 60 * 1000;
const PROBE_GIVE_UP_MS = 10 * 60 * 1000;
const INSIDE = "https://glow-bot.internal"; // addresses used between the Worker and its Durable Objects

function buildOf(env) {
  return String((env && env.BUILD) || "dev");
}

// The setup code is a long random secret only the owner has. The Worker only knows its SHA-256.
async function hasSetupCode(request, env) {
  const given = request.headers.get("X-Glow-Setup-Code") || "";
  const expected = String((env && env.SETUP_CODE_SHA256) || "");
  if (!given || !expected) return false;
  return safeEqual(await sha256Hex(given), expected);
}

// Everything is built by one function so the tests can hand in a pretend network and a pretend clock.
export function createWorker(overrides) {
  const deps = {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    probe: runProbe,
    ...overrides,
  };

  // One per chat (later). For now the only instance is "sys:probe", which runs the health check.
  class ChatAgent {
    constructor(state, env) {
      this.storage = state.storage;
      this.env = env;
    }

    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/probe") return this.probe(url.searchParams.get("fresh") === "1");
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

    // Never throws: a failed alarm would be retried by Cloudflare and run the whole check again.
    async alarm() {
      try {
        const run = await this.storage.get("probe:run");
        if (!run) return;
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
  }

  // Will hold the bot's token, its owner and who may use it. Nothing is stored yet.
  class Registry {
    constructor(state, env) {
      this.storage = state.storage;
      this.env = env;
    }

    async fetch() {
      return json({ ok: false, error: "not found" }, 404);
    }
  }

  async function route(request, env, cors) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (request.method === "GET" && path === "/") {
      const pages = String(env.GLOW_PAGES || "https://juw12.github.io/projects/glow").replace(/\/+$/, "");
      return new Response(`GlowBot ${VERSION} is running. Glow lives at ${pages}/\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...cors },
      });
    }

    if (request.method === "GET" && path === "/v1/status") {
      return json(
        {
          ok: true,
          service: "glow-bot",
          version: VERSION,
          build: buildOf(env),
          stage: "probe",
          configured: false,
          bot: null,
          access: "private",
          ai: !!env.AI,
          colo: (request.cf && request.cf.colo) || "",
        },
        200,
        cors,
      );
    }

    if (request.method === "GET" && path === "/v1/probe") {
      const fresh = url.searchParams.get("fresh") === "1";
      if (fresh && !(await hasSetupCode(request, env))) {
        return json({ ok: false, error: "A fresh check needs the setup code." }, 403, cors);
      }
      const agent = env.CHAT.get(env.CHAT.idFromName("sys:probe"));
      const reply = await agent.fetch(INSIDE + "/probe" + (fresh ? "?fresh=1" : ""));
      return json(await reply.json(), reply.status, cors);
    }

    return json({ ok: false, error: "not found" }, 404, cors);
  }

  const worker = {
    async fetch(request, env) {
      const cors = corsHeaders(request, env);
      try {
        return await route(request, env, cors);
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
