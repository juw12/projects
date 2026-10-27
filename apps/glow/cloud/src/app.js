// Glow cloud browser service: GlowLead (website or Android app) asks for a short-lived hidden browser and drives it
// one action at a time through the shared Glow Hands core, with the same safety rules as Glow Hands on a PC.
// The browser provider is injected ({ launch, connect }) so the same code runs on Cloudflare and in tests.
import * as coreModule from "../../web/shared/hands-core.js";
import { handleLicense, plansInfo } from "./license.js";

const Core = globalThis.GlowHandsCore || coreModule.default || coreModule;
const SESSION = /^[0-9a-zA-Z-]{8,80}$/;
const PATHS = new Set(["status", "observe", "act", "close"]);
const MAX_BODY = 64 * 1024;
const KEEP_ALIVE_MS = 5 * 60 * 1000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + " took too long")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function pageDriver(page) {
  const selector = (ref) => '[data-glow-ref="' + Number(ref) + '"]';
  // Every step has a time limit so a stuck page can never hang the request.
  return {
    evaluate: (source, arg) => withTimeout(page.evaluate("(" + source + ")(" + JSON.stringify(arg) + ")"), 15000, "Reading the page"),
    goto: (url) => withTimeout(page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }), 35000, "Opening the page"),
    back: () => withTimeout(page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }), 18000, "Going back").catch(() => null),
    info: async () => {
      // Reading the title fails while a page is still navigating; give it a moment and try again.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          return { url: page.url(), title: await withTimeout(page.title(), 3000, "Reading the title") };
        } catch (error) {
          await pause(700);
        }
      }
      return { url: page.url(), title: "" };
    },
    settle: async () => {
      await withTimeout(page.waitForNetworkIdle({ idleTime: 400, timeout: 5000 }), 6000, "Waiting for the page").catch(() => {});
    },
    click: async (ref) => {
      // Click inside the page on the next tick, so this call returns before any navigation starts.
      const clicked = await withTimeout(
        page.evaluate(
          "(() => { const node = document.querySelector(" + JSON.stringify(selector(ref)) + "); if (!node) return false; " +
            "node.scrollIntoView({ block: 'center' }); setTimeout(() => node.click(), 0); return true; })()",
        ),
        10000,
        "Clicking",
      );
      if (!clicked) throw new Error("That element is no longer on the page. Observe again.");
      await pause(800);
      if (page.waitForNavigation) {
        await withTimeout(page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }), 9000, "Loading").catch(() => null);
      }
    },
    fill: async (ref, text) => {
      await withTimeout(
        page.$eval(selector(ref), (node) => {
          if (node.isContentEditable) node.textContent = "";
          else node.value = "";
        }),
        10000,
        "Clearing the field",
      );
      await withTimeout(page.type(selector(ref), text), 20000, "Typing");
    },
    press: (key) => withTimeout(page.keyboard.press(key), 10000, "Pressing a key"),
    scroll: (dy) => withTimeout(page.mouse.wheel({ deltaY: dy }), 10000, "Scrolling"),
  };
}

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function corsHeaders(origin) {
  return origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

function friendlyStartError(error) {
  const text = String((error && error.message) || error);
  if (/429|rate limit|quota|exceeded|limit/i.test(text)) {
    return { status: 429, error: "Today's free cloud browser time is used up. Try again tomorrow, or use Glow Hands on your PC or the Glow app." };
  }
  return { status: 503, error: "The cloud browser is busy right now. Try again in a minute." };
}

export function createApp({ launch, connect, fetch: fetchImpl = globalThis.fetch }) {
  async function startSession() {
    const browser = await launch({ keep_alive: KEEP_ALIVE_MS });
    try {
      const page = await browser.newPage();
      if (page.setViewport) await page.setViewport({ width: 1280, height: 860 });
      return { session: browser.sessionId(), idleMinutes: KEEP_ALIVE_MS / 60000 };
    } finally {
      await browser.disconnect();
    }
  }

  async function callSession(session, path, body) {
    let browser;
    try {
      browser = await connect(session);
    } catch (error) {
      return { status: 410, error: "This cloud browser session has ended. Start it again." };
    }
    let closed = false;
    try {
      if (path === "close") {
        closed = true;
        await browser.close();
        return { status: 200, closed: true };
      }
      const pages = await browser.pages();
      const page = pages.find((candidate) => !candidate.url().startsWith("chrome://")) || pages[0] || (await browser.newPage());
      const core = Core.createHandsCore(pageDriver(page), { mode: "cloud" });
      return await core.handle(path, body);
    } finally {
      if (!closed) await browser.disconnect().catch(() => {});
    }
  }

  return async function handle(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const origins = allowedOrigins(env);
    if (!origins.has(origin)) return json({ error: "This website is not allowed to use the Glow cloud browser." }, 403, "");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders(origin), "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" },
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/status") return json({ ok: true, app: "glow-cloud", version: Core.VERSION }, 200, origin);
    if (request.method === "GET" && url.pathname === "/v1/plans") return json(plansInfo(env), 200, origin);
    if (request.method !== "POST") return json({ error: "Not found." }, 404, origin);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_BODY) return json({ error: "Request too large." }, 413, origin);

    if (url.pathname === "/v1/license") {
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return json({ error: "Invalid JSON." }, 400, origin);
      }
      const result = await handleLicense(body, env, fetchImpl);
      return json(result, result.status || 200, origin);
    }
    if (url.pathname === "/v1/sessions") {
      try {
        return json(await startSession(), 200, origin);
      } catch (error) {
        const failure = friendlyStartError(error);
        return json({ error: failure.error }, failure.status, origin);
      }
    }
    const match = /^\/v1\/sessions\/([^/]+)\/call$/.exec(url.pathname);
    if (!match) return json({ error: "Not found." }, 404, origin);
    const session = decodeURIComponent(match[1]);
    if (!SESSION.test(session)) return json({ error: "Invalid session." }, 400, origin);
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return json({ error: "Invalid JSON." }, 400, origin);
    }
    const path = String((payload && payload.path) || "");
    if (!PATHS.has(path)) return json({ error: "Not found." }, 404, origin);
    try {
      const result = await callSession(session, path, payload.body || null);
      return json(result, result.status || 200, origin);
    } catch (error) {
      console.error("glow-cloud call failed", path, String((error && error.stack) || error));
      return json({ error: "The cloud browser had a problem with that step. Try again." }, 502, origin);
    }
  };
}
