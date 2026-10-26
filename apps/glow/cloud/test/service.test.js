// Exercises the Glow cloud browser service with a real Chromium (Playwright core) shaped like Cloudflare's puppeteer.
// Run: GLOW_PLAYWRIGHT_CORE=<path to playwright-core package> node --test apps/glow/cloud/test/
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";

const corePath = process.env.GLOW_PLAYWRIGHT_CORE;
const FORM = `<!doctype html><title>Test shop</title><h1>Checkout</h1>
<form action="/done.html" method="get">
<label for="name">Full name</label><input id="name" name="name">
<label for="size">Size</label><select id="size" name="size"><option>Small</option><option>Large</option></select>
<label for="pw">Password</label><input id="pw" type="password" name="pw">
<button type="submit">Place order</button></form>`;
const DONE = "<!doctype html><title>Done</title><h1>Order received</h1>";
const ORIGIN = "https://juw12.github.io";
const ENV = { ALLOWED_ORIGINS: "https://juw12.github.io,https://localhost" };

function adaptPage(page) {
  return {
    evaluate: (expression) => page.evaluate(expression),
    goto: (url, options) => page.goto(url, options),
    goBack: (options) => page.goBack(options),
    url: () => page.url(),
    title: () => page.title(),
    waitForNetworkIdle: ({ timeout }) => page.waitForLoadState("networkidle", { timeout }),
    click: (selector) => page.click(selector),
    $eval: (selector, fn) => page.$eval(selector, fn),
    type: (selector, text) => page.type(selector, text),
    keyboard: { press: (key) => page.keyboard.press(key) },
    mouse: { wheel: ({ deltaY }) => page.mouse.wheel(0, deltaY) },
    setViewport: ({ width, height }) => page.setViewportSize({ width, height }),
  };
}

test("Glow cloud browser service", { skip: !corePath && "Set GLOW_PLAYWRIGHT_CORE to run" }, async (t) => {
  const { chromium } = createRequire(import.meta.url)(corePath);
  const browser = await chromium.launch();
  const sessions = new Map();
  let failNextLaunch = null;
  const provider = {
    launch: async () => {
      if (failNextLaunch) {
        const message = failNextLaunch;
        failNextLaunch = null;
        throw new Error(message);
      }
      const context = await browser.newContext();
      // A public-looking shop served in-process (the service refuses private addresses).
      await context.route("http://shop.test/**", (route) => route.fulfill({
        contentType: "text/html",
        body: new URL(route.request().url()).pathname.startsWith("/done.html") ? DONE : FORM,
      }));
      const id = randomUUID();
      sessions.set(id, context);
      return {
        newPage: async () => adaptPage(await context.newPage()),
        sessionId: () => id,
        disconnect: async () => {},
      };
    },
    connect: async (id) => {
      const context = sessions.get(id);
      if (!context) throw new Error("Unable to connect to existing session");
      return {
        pages: async () => context.pages().map(adaptPage),
        newPage: async () => adaptPage(await context.newPage()),
        disconnect: async () => {},
        close: async () => {
          sessions.delete(id);
          await context.close();
        },
      };
    },
  };
  const handle = createApp(provider);
  const send = async (path, body, origin = ORIGIN, method = "POST") => {
    const headers = { "Content-Type": "application/json" };
    if (origin) headers.Origin = origin;
    const response = await handle(new Request("https://glow-cloud.example" + path, {
      method, headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    }), ENV);
    return { status: response.status, data: await response.json().catch(() => ({})), headers: response.headers };
  };
  t.after(async () => {
    await browser.close();
  });

  await t.test("only GlowLead's own sites may use it", async () => {
    assert.equal((await send("/v1/sessions", {}, "https://evil.example")).status, 403);
    assert.equal((await send("/v1/sessions", {}, "")).status, 403);
    const preflight = await handle(new Request("https://glow-cloud.example/v1/sessions", { method: "OPTIONS", headers: { Origin: ORIGIN } }), ENV);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  });

  await t.test("a session runs a mission with approval before submitting", async () => {
    const started = await send("/v1/sessions");
    assert.equal(started.status, 200);
    const session = started.data.session;
    const call = (path, body) => send("/v1/sessions/" + session + "/call", { path, body });
    const status = await call("status");
    assert.equal(status.status, 200);
    assert.equal(status.data.mode, "cloud");
    assert.equal((await call("act", { action: { action: "goto", url: "http://shop.test/form.html" } })).status, 200);
    const seen = (await call("observe")).data;
    assert.equal(seen.title, "Test shop");
    const ref = (label) => seen.elements.find((element) => element.name === label).ref;
    assert.equal((await call("act", { action: { action: "type", ref: ref("Full name"), text: "Cloud User" } })).status, 200);
    assert.equal((await call("act", { action: { action: "select", ref: ref("Size"), text: "Large" } })).status, 200);
    const password = await call("act", { action: { action: "type", ref: ref("Password"), text: "secret" } });
    assert.equal(password.status, 403);
    assert.equal(password.data.secret, true);
    const blocked = await call("act", { action: { action: "click", ref: ref("Place order") } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.needsApproval, true);
    assert.equal((await call("observe")).data.title, "Test shop", "Nothing was submitted before approval");
    const approved = await call("act", { action: { action: "click", ref: ref("Place order") }, approved: true });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.title, "Done");
    assert.match(approved.data.url, /name=Cloud\+User/);
    assert.match(approved.data.url, /size=Large/);
    assert.equal((await call("act", { action: { action: "goto", url: "http://127.0.0.1:8080/" } })).status, 400);
    assert.equal((await call("act", { action: { action: "goto", url: "file:///etc/passwd" } })).status, 400);
    assert.equal((await call("evaluate", {})).status, 404);
    assert.equal((await call("close")).status, 200);
    assert.equal((await call("status")).status, 410, "A closed session is gone");
  });

  await t.test("unknown sessions and daily limits are explained", async () => {
    assert.equal((await send("/v1/sessions/00000000-0000-0000-0000-000000000000/call", { path: "status" })).status, 410);
    assert.equal((await send("/v1/sessions/bad id!/call", { path: "status" })).status, 400);
    failNextLaunch = "429 Too Many Requests: browser time limit exceeded";
    const quota = await send("/v1/sessions");
    assert.equal(quota.status, 429);
    assert.match(quota.data.error, /free cloud browser time/i);
    failNextLaunch = "Browser unavailable";
    assert.equal((await send("/v1/sessions")).status, 503);
  });
});
