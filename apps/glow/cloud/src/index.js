// Cloudflare entry point: Browser Rendering (free plan: shared daily minutes, a few browsers at once).
import puppeteer from "@cloudflare/puppeteer";
import { createApp } from "./app.js";

export default {
  async fetch(request, env) {
    const handle = createApp({
      launch: (options) => puppeteer.launch(env.BROWSER, options),
      connect: (session) => puppeteer.connect(env.BROWSER, session),
    });
    return handle(request, env);
  },
};
