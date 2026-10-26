// Test-only browser provider shaped like Cloudflare's puppeteer binding, backed by Playwright core.
// "shop.test" is a public-looking test shop served in-process (the service refuses private addresses).
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

export const FORM = `<!doctype html><title>Test shop</title><h1>Checkout</h1>
<form action="/done.html" method="get">
<label for="name">Full name</label><input id="name" name="name">
<label for="size">Size</label><select id="size" name="size"><option>Small</option><option>Large</option></select>
<label for="pw">Password</label><input id="pw" type="password" name="pw">
<button type="submit">Place order</button></form>`;
export const DONE = "<!doctype html><title>Done</title><h1>Order received</h1>";

function adaptPage(page) {
  return {
    evaluate: (expression) => page.evaluate(expression),
    goto: (url, options) => page.goto(url, options),
    goBack: (options) => page.goBack(options),
    url: () => page.url(),
    title: () => page.title(),
    waitForNetworkIdle: ({ timeout }) => page.waitForLoadState("networkidle", { timeout }),
    click: (selector) => page.click(selector),
    waitForNavigation: ({ timeout }) => page.waitForLoadState("domcontentloaded", { timeout }),
    $eval: (selector, fn) => page.$eval(selector, fn),
    type: (selector, text) => page.type(selector, text),
    keyboard: { press: (key) => page.keyboard.press(key) },
    mouse: { wheel: ({ deltaY }) => page.mouse.wheel(0, deltaY) },
    setViewport: ({ width, height }) => page.setViewportSize({ width, height }),
  };
}

export async function createTestProvider(corePath) {
  const { chromium } = createRequire(import.meta.url)(corePath);
  const browser = await chromium.launch();
  const sessions = new Map();
  const provider = {
    failNextLaunch: null,
    launch: async () => {
      if (provider.failNextLaunch) {
        const message = provider.failNextLaunch;
        provider.failNextLaunch = null;
        throw new Error(message);
      }
      const context = await browser.newContext();
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
    close: () => browser.close(),
  };
  return provider;
}
