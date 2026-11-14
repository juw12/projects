// The health check: every free model, every way to reach the web, GlowNews and GlowSpark, each tried
// once from where the bot really runs. The answers decide which models the bot asks first, and the
// GlowBot page shows them so anyone can see what is working right now.

import { AI_MODELS, KEYLESS, askEntry } from "./models.js";
import { createSpark } from "./spark.js";
import { clip, errorText, inBatches, withTimeout } from "./util.js";
import { transcribeBytes } from "./voice.js";
import { createWeb } from "./web.js";

const PING = [{ role: "user", content: "Reply with the single word: pong" }];
const SEARCH_QUERY = "Cloudflare Workers free plan limits";
const PAGE_TO_READ = "https://example.com/";
const PAGE_SAYS = /example domain|documentation/i;
const TALE_OPENING = "Once upon a time";
// Three ordinary pages of different kinds (an encyclopedia, a news site, a manual), read the way the
// researcher reads them. This answers, with a measurement, whether real sites let the bot in.
const PAGES_TO_READ = [
  "https://en.wikipedia.org/wiki/Cloudflare",
  "https://www.bbc.com/news",
  "https://developers.cloudflare.com/workers/platform/limits/",
];
const PAGE_TEXT_ENOUGH = 400; // fewer characters than this is a cookie wall or an empty shell, not a page
// A real Telegram-style voice note (OGG/Opus) kept beside the GlowBot page. It says "Hello GlowBot.
// Please tell me three facts about the planet Mars.", so a transcript with "Mars" in it was heard.
const VOICE_SAMPLE = "/bot/voice-check.ogg";
const VOICE_SAYS = /\bmars\b/i;
const AT_ONCE = 4; // a Worker may only have six connections waiting at once

function oneLine(text, max) {
  return clip(String(text == null ? "" : text).replace(/\s+/g, " ").trim(), max);
}

// runProbe({ fetch, ai, now, glowPages, providers, aiModels, pages, timeoutMs }) -> the report (it never throws)
export async function runProbe(options) {
  const settings = options || {};
  const send = settings.fetch || ((input, init) => fetch(input, init));
  const now = settings.now || (() => Date.now());
  const timeoutMs = settings.timeoutMs || 25000;
  const glowPages = String(settings.glowPages || "https://juw12.github.io/projects/glow").replace(/\/+$/, "");
  const providers = settings.providers || KEYLESS;
  const aiModels = settings.ai ? settings.aiModels || AI_MODELS : [];
  const pages = settings.pages || PAGES_TO_READ;
  const web = createWeb({ fetch: send, timeoutMs: Math.min(timeoutMs, 20000), glowPages });
  const spark = createSpark({ fetch: send, base: glowPages + "/spark", now });
  const request = { messages: PING, temperature: 0, maxTokens: 200 };

  const started = now();
  const report = {
    at: started,
    ms: 0,
    providers: new Array(providers.length).fill(null),
    ai: new Array(aiModels.length).fill(null),
    aiModelList: null,
    web: new Array(web.searchers.length + web.readers.length).fill(null),
    spark: null,
    news: null,
    pages: new Array(pages.length).fill(null),
    voice: null,
  };
  const tasks = [];

  providers.forEach((entry, index) => {
    tasks.push(async () => {
      const began = now();
      try {
        const answer = await askEntry(entry, request, { fetch: send, timeoutMs });
        report.providers[index] = {
          id: entry.id,
          model: entry.model,
          ok: true,
          status: answer.status,
          ms: now() - began,
          sample: oneLine(answer.text, 60),
          error: "",
        };
      } catch (error) {
        report.providers[index] = {
          id: entry.id,
          model: entry.model,
          ok: false,
          status: (error && error.status) || 0,
          ms: now() - began,
          sample: "",
          error: oneLine(errorText(error), 160),
        };
      }
    });
  });

  aiModels.forEach((entry, index) => {
    tasks.push(async () => {
      const began = now();
      try {
        const answer = await askEntry(entry, request, { ai: settings.ai, timeoutMs, shapes: ["messages", "responses"] });
        report.ai[index] = {
          id: entry.id,
          model: entry.model,
          ok: true,
          ms: now() - began,
          shape: answer.shape,
          field: answer.field,
          sample: oneLine(answer.text, 60),
          error: "",
        };
      } catch (error) {
        report.ai[index] = {
          id: entry.id,
          model: entry.model,
          ok: false,
          ms: now() - began,
          shape: "",
          field: "",
          sample: "",
          error: oneLine(errorText(error), 240),
        };
      }
    });
  });

  web.searchers.forEach((searcher, index) => {
    tasks.push(async () => {
      const began = now();
      const row = { id: "search:" + searcher.id, ok: false, status: 0, ms: 0, detail: "" };
      try {
        const results = await searcher.run(SEARCH_QUERY);
        row.ok = results.length >= (searcher.lastResort ? 1 : 2);
        row.status = 200;
        row.detail = `${results.length} results` + (results[0] ? `; first: ${oneLine(results[0].title, 60)}` : "");
      } catch (error) {
        row.status = (error && error.status) || 0;
        row.detail = oneLine(errorText(error), 160);
      }
      row.ms = now() - began;
      report.web[index] = row;
    });
  });

  web.readers.forEach((reader, index) => {
    tasks.push(async () => {
      const began = now();
      const row = { id: "read:" + reader.id, ok: false, status: 0, ms: 0, detail: "" };
      try {
        const page = String(await reader.run(PAGE_TO_READ));
        row.ok = PAGE_SAYS.test(page);
        row.status = 200;
        row.detail = `${page.length} characters` + (row.ok ? "" : `; starts: ${oneLine(page, 60)}`);
      } catch (error) {
        row.status = (error && error.status) || 0;
        row.detail = oneLine(errorText(error), 160);
      }
      row.ms = now() - began;
      report.web[web.searchers.length + index] = row;
    });
  });

  tasks.push(async () => {
    try {
      const edition = await web.news();
      report.news = { ok: edition.stories.length > 0, stories: edition.stories.length, error: "" };
    } catch (error) {
      report.news = { ok: false, stories: 0, error: oneLine(errorText(error), 160) };
    }
  });

  tasks.push(async () => {
    try {
      const loaded = await spark.load();
      const tale = spark.write(TALE_OPENING, { maxTokens: 40, seed: 7 });
      report.spark = {
        ok: tale.tokens >= 40 && tale.text.trim().length > 0,
        loadMs: loaded.downloadMs + loaded.buildMs,
        tokens: tale.tokens,
        sample: oneLine(tale.text, 120),
        parameters: loaded.parameters,
        error: "",
      };
    } catch (error) {
      report.spark = { ok: false, loadMs: 0, tokens: 0, sample: "", parameters: 0, error: oneLine(errorText(error), 160) };
    }
  });

  pages.forEach((address, index) => {
    tasks.push(async () => {
      const began = now();
      const row = { url: address, ok: false, via: "", chars: 0, ms: 0, error: "" };
      try {
        const page = await web.read(address);
        row.via = page.via;
        row.chars = page.text.length;
        row.ok = row.chars >= PAGE_TEXT_ENOUGH;
        if (!row.ok) row.error = "too little text: " + oneLine(page.text, 80);
      } catch (error) {
        row.error = oneLine(errorText(error), 200);
      }
      row.ms = now() - began;
      report.pages[index] = row;
    });
  });

  // Can the bot hear? The same two Whisper models a voice note goes through, on a real OGG/Opus file.
  if (settings.ai) {
    tasks.push(async () => {
      const began = now();
      const row = { ok: false, model: "", heard: "", bytes: 0, ms: 0, error: "" };
      try {
        const bytes = await withTimeout(
          async (signal) => {
            const response = await send(glowPages + VOICE_SAMPLE, { signal });
            if (!response.ok) throw new Error(`the sample answered HTTP ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
          },
          timeoutMs,
          "voice sample",
        );
        row.bytes = bytes.length;
        const heard = await transcribeBytes({ ai: settings.ai, bytes, timeoutMs });
        row.model = heard.model;
        row.heard = oneLine(heard.text, 120);
        row.ok = VOICE_SAYS.test(heard.text);
        if (!row.ok) row.error = "the transcript does not mention Mars";
      } catch (error) {
        row.error = oneLine(errorText(error), 200);
      }
      row.ms = now() - began;
      report.voice = row;
    });
  }

  // Which text models this account can really call, so the list above can be kept honest.
  if (settings.ai && typeof settings.ai.models === "function") {
    tasks.push(async () => {
      try {
        const listed = await withTimeout(() => settings.ai.models({ per_page: 200 }), 15000, "Workers AI model list");
        const all = Array.isArray(listed) ? listed : [];
        report.aiModelList = {
          total: all.length,
          textGeneration: all
            .filter((model) => /text generation/i.test(String((model && model.task && model.task.name) || "")))
            .map((model) => String(model.name || model.id)),
        };
      } catch (error) {
        report.aiModelList = { error: oneLine(errorText(error), 160) };
      }
    });
  }

  await inBatches(tasks, AT_ONCE);
  report.ms = now() - started;
  return report;
}
