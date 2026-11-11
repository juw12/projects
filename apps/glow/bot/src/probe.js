// The health check: every free model, every way to reach the web, GlowNews and GlowSpark, each tried
// once from where the bot really runs. The answers decide which models the bot asks first, and the
// GlowBot page shows them so anyone can see what is working right now.

import { AI_MODELS, KEYLESS, askEntry } from "./models.js";
import { createSpark } from "./spark.js";
import { clip, errorText, inBatches, withTimeout } from "./util.js";
import { USER_AGENT, createWeb } from "./web.js";

const PING = [{ role: "user", content: "Reply with the single word: pong" }];
const SEARCH_QUERY = "Cloudflare Workers free plan limits";
const PAGE_TO_READ = "https://example.com/";
const PAGE_SAYS = /example domain|documentation/i;
const TALE_OPENING = "Once upon a time";
const AT_ONCE = 4; // a Worker may only have six connections waiting at once

// TEMPORARY, removed once the search order is decided: which keyless search services answer from where
// the bot really runs. Nothing here is used to answer anyone. Each row keeps the status, the content
// type, a few marker counts and a short sample of the body, so parsers get written for what really
// arrives at Cloudflare and not for what a desktop browser sees.
const REACH = [
  { id: "bing-rss", url: (q) => `https://www.bing.com/search?format=rss&q=${q}`, from: /<item\b/i },
  { id: "bing-news-rss", url: (q) => `https://www.bing.com/news/search?format=rss&q=${q}`, from: /<item\b/i },
  { id: "bing-html", url: (q) => `https://www.bing.com/search?q=${q}`, from: /<li class="b_algo/i },
  { id: "brave", url: (q) => `https://search.brave.com/search?q=${q}&source=web`, from: /class="snippet\b/i },
  { id: "duckduckgo-lite", url: (q) => `https://lite.duckduckgo.com/lite/?q=${q}`, from: /result-link/i },
  {
    id: "duckduckgo-post",
    url: () => "https://html.duckduckgo.com/html/",
    body: (q) => `q=${q}`,
    from: /result__a/i,
  },
  {
    id: "duckduckgo-instant",
    url: (q) => `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`,
  },
  { id: "mojeek", url: (q) => `https://www.mojeek.com/search?q=${q}`, from: /class="results-standard/i },
  {
    id: "qwant",
    url: (q) =>
      `https://api.qwant.com/v3/search/web?q=${q}&count=10&locale=en_US&offset=0&device=desktop&safesearch=1`,
  },
  {
    id: "yep",
    url: (q) =>
      `https://api.yep.com/fs/2/search?client=web&gl=US&no_correct=false&q=${q}&safeSearch=moderate&type=web`,
  },
  { id: "marginalia", url: (q) => `https://api.marginalia.nu/public/search/${q}?count=8` },
  { id: "hn-algolia", url: (q) => `https://hn.algolia.com/api/v1/search?query=${q}&hitsPerPage=8` },
  {
    id: "gdelt",
    url: (q) => `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=10&format=json`,
  },
  {
    id: "google-news-rss",
    url: (q) => `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
    from: /<item\b/i,
  },
  { id: "openalex", url: (q) => `https://api.openalex.org/works?search=${q}&per-page=5` },
];
const REACH_MARKS = {
  items: /<item\b/gi,
  algo: /b_algo/g,
  resultLinks: /result__a|result-link/g,
  snippets: /snippet/gi,
  jsonUrls: /"url"\s*:/g,
  blocked: /captcha|challenge|unusual traffic|anomaly|are you a robot|access denied/gi,
};
const REACH_BODY_CHARS = 600000;

function oneLine(text, max) {
  return clip(String(text == null ? "" : text).replace(/\s+/g, " ").trim(), max);
}

// runProbe({ fetch, ai, now, glowPages, providers, aiModels, timeoutMs }) -> the report (it never throws)
export async function runProbe(options) {
  const settings = options || {};
  const send = settings.fetch || ((input, init) => fetch(input, init));
  const now = settings.now || (() => Date.now());
  const timeoutMs = settings.timeoutMs || 25000;
  const glowPages = String(settings.glowPages || "https://juw12.github.io/projects/glow").replace(/\/+$/, "");
  const providers = settings.providers || KEYLESS;
  const aiModels = settings.ai ? settings.aiModels || AI_MODELS : [];
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
    reach: new Array(REACH.length).fill(null),
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

  // TEMPORARY (see REACH above).
  REACH.forEach((candidate, index) => {
    tasks.push(async () => {
      const began = now();
      const row = { id: candidate.id, ok: false, status: 0, type: "", length: 0, ms: 0, marks: {}, sample: "", error: "" };
      const query = encodeURIComponent(SEARCH_QUERY);
      const address = candidate.url(query);
      const headers = { "User-Agent": USER_AGENT, Accept: "*/*", "Accept-Language": "en" };
      const init = { headers };
      if (candidate.body) {
        init.method = "POST";
        init.body = candidate.body(query);
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
      try {
        const answer = await withTimeout(
          async (inner) => {
            const response = await send(address, { ...init, signal: inner });
            return { response, body: (await response.text()).slice(0, REACH_BODY_CHARS) };
          },
          Math.min(timeoutMs, 12000),
          "reach " + candidate.id,
        );
        const body = answer.body;
        row.ok = answer.response.ok;
        row.status = answer.response.status;
        row.type = clip(answer.response.headers.get("Content-Type") || "", 60);
        row.length = body.length;
        for (const name of Object.keys(REACH_MARKS)) row.marks[name] = (body.match(REACH_MARKS[name]) || []).length;
        const at = candidate.from ? body.search(candidate.from) : 0;
        const start = Math.max(at, 0);
        row.sample = oneLine(body.slice(start, start + 3000), 500);
      } catch (error) {
        row.error = oneLine(errorText(error), 160);
      }
      row.ms = now() - began;
      report.reach[index] = row;
    });
  });

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
