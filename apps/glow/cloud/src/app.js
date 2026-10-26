// Glow cloud browser service: GlowLead (website or Android app) asks for a short-lived hidden browser and drives it
// one action at a time through the shared Glow Hands core, with the same safety rules as Glow Hands on a PC.
// The browser provider is injected ({ launch, connect }) so the same code runs on Cloudflare and in tests.
import * as coreModule from "../../web/shared/hands-core.js";

const Core = globalThis.GlowHandsCore || coreModule.default || coreModule;
const SESSION = /^[0-9a-zA-Z-]{8,80}$/;
const PATHS = new Set(["status", "observe", "act", "close"]);
const MAX_BODY = 64 * 1024;
const KEEP_ALIVE_MS = 10 * 60 * 1000;

export function pageDriver(page) {
  const selector = (ref) => '[data-glow-ref="' + Number(ref) + '"]';
  return {
    evaluate: (source, arg) => page.evaluate("(" + source + ")(" + JSON.stringify(arg) + ")"),
    goto: (url) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }),
    back: () => page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
    info: async () => {
      // Reading the title fails while a page is still navigating; give it a moment and try again.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          return { url: page.url(), title: await page.title() };
        } catch (error) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      return { url: page.url(), title: "" };
    },
    settle: async () => {
      await page.waitForNetworkIdle({ idleTime: 400, timeout: 5000 }).catch(() => {});
    },
    click: async (ref) => {
      const navigation = page.waitForNavigation
        ? page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null)
        : Promise.resolve(null);
      await page.click(selector(ref));
      await navigation;
    },
    fill: async (ref, text) => {
      await page.$eval(selector(ref), (node) => {
        if (node.isContentEditable) node.textContent = "";
        else node.value = "";
      });
      await page.type(selector(ref), text);
    },
    press: (key) => page.keyboard.press(key),
    scroll: (dy) => page.mouse.wheel({ deltaY: dy }),
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

export function createApp({ launch, connect }) {
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
    if (request.method !== "POST") return json({ error: "Not found." }, 404, origin);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_BODY) return json({ error: "Request too large." }, 413, origin);

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
