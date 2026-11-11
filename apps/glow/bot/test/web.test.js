import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSearchMarkdown } from "../src/crew-port.js";
import { StoppedError } from "../src/util.js";
import { WebError, createWeb, decodeEntities, htmlToText, isPublicUrl, parseDuckHtml } from "../src/web.js";
import { fakeFetch, reply } from "./fakes.js";

const READER = "https://r.jina.ai/";
const LITE = READER + "https://lite.duckduckgo.com/lite/?q=";
const BING = READER + "https://www.bing.com/search?q=";
const DUCK = READER + "https://html.duckduckgo.com/html/?q=";
const DUCK_DIRECT = "https://html.duckduckgo.com/html/?q=";
const WIKIPEDIA = "https://en.wikipedia.org/w/api.php";
const HTML = { headers: { "Content-Type": "text/html; charset=utf-8" } };

// What the reader sends back for a results page with `count` results.
function resultsPage(count) {
  let page = "";
  for (let number = 1; number <= count; number++) {
    page += `## [Result number ${number} about the free plan](https://site${number}.example/page)\nSnippet ${number}.\n\n`;
  }
  return page;
}

// One result the way DuckDuckGo's plain HTML page writes it (the link is wrapped in a redirect).
function duckResult(title, link, snippet) {
  const href = "//duckduckgo.com/l/?uddg=" + encodeURIComponent(link) + "&amp;rut=abc";
  return (
    `<div class="result results_links web-result"><h2 class="result__title">` +
    `<a rel="nofollow" class="result__a" href="${href}">${title}</a></h2>` +
    (snippet ? `<a class="result__snippet" href="${href}">${snippet}</a>` : "") +
    `</div>\n`
  );
}

function hangUntilAborted(url, init) {
  return new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
  });
}

test("entities are decoded in one pass", () => {
  assert.equal(
    decodeEntities("Tom &amp; Jerry &lt;3 &quot;cheese&quot; &#39;now&#39; &#x27;ok&#x27;"),
    `Tom & Jerry <3 "cheese" 'now' 'ok'`,
  );
  assert.equal(decodeEntities("&amp;lt;b&amp;gt;"), "&lt;b&gt;", "decoded once, not twice");
  assert.equal(decodeEntities("caf&eacute; &nbsp;&hellip;"), "caf&eacute;  …", "a name it does not know is left as it is");
  assert.equal(decodeEntities("&#128640; &#x1F680;"), "🚀 🚀");
  assert.equal(decodeEntities("&#0; &#xD800; &#1114112;"), "&#0; &#xD800; &#1114112;", "impossible characters are left alone");
  assert.equal(decodeEntities(null), "");
});

test("a web page becomes its readable text", () => {
  const page =
    "<!doctype html><html><head><title>Ignored</title><style>p { color: red }</style></head><body>" +
    "<!-- a note for developers --><h1>Hello &amp; welcome</h1><p>First<br>line</p>" +
    "<script>alert('no')</script><p>Second</p></body></html>";
  assert.equal(htmlToText(page), "Hello & welcome\nFirst\nline\nSecond");
  assert.equal(htmlToText("<p>A</p>\n\n\n\n<p>B</p>"), "A\n\nB", "at most one blank line between blocks");
  assert.equal(htmlToText("<ul><li>one</li><li>two   words</li></ul>"), "one\ntwo words");
  assert.equal(htmlToText(null), "");
});

test("results are read from the reader's Markdown the way GlowRoom reads them", () => {
  const markdown = [
    "## [Workers limits · Cloudflare docs](https://developers.cloudflare.com/workers/platform/limits/)",
    "The free plan allows **100,000 requests** per day. [Read more](https://x.example/more)",
    "",
    "1. [Pricing · Cloudflare Workers](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpricing&rut=1)",
    "Snippet two.",
    "### [The search engine itself](https://www.bing.com/search?q=x)",
    "## [Short](https://example.org/short)",
    "## [Workers limits again](https://developers.cloudflare.com/workers/platform/limits/)",
  ].join("\n");
  assert.deepEqual(parseSearchMarkdown(markdown), [
    {
      title: "Workers limits · Cloudflare docs",
      url: "https://developers.cloudflare.com/workers/platform/limits/",
      snippet: "The free plan allows 100,000 requests per day. Read more",
    },
    { title: "Pricing · Cloudflare Workers", url: "https://example.org/pricing", snippet: "Snippet two." },
  ]);
  assert.equal(parseSearchMarkdown(resultsPage(9)).length, 6, "six results at most");
});

test("results are read from DuckDuckGo's plain page", () => {
  const page =
    "<html><body>" +
    duckResult(
      "Limits &middot; Cloudflare <b>Workers</b> docs",
      "https://developers.cloudflare.com/workers/platform/limits/",
      "The <b>free</b> plan allows 100,000 requests per day &amp; 10 ms of CPU.",
    ) +
    duckResult("A page with no description", "https://example.org/plain", "") +
    duckResult("Pricing for the paid plan", "https://example.org/pricing?plan=paid&x=1", "Five dollars a month.") +
    duckResult("The first page once more", "https://developers.cloudflare.com/workers/platform/limits/", "Seen already.") +
    duckResult("An advert for something", "https://duckduckgo.com/y.js?ad_domain=shop.example", "Buy now.") +
    duckResult("Home", "https://example.org/home", "The title is too short to be a real result.") +
    "</body></html>";
  assert.deepEqual(parseDuckHtml(page), [
    {
      title: "Limits · Cloudflare Workers docs",
      url: "https://developers.cloudflare.com/workers/platform/limits/",
      snippet: "The free plan allows 100,000 requests per day & 10 ms of CPU.",
    },
    { title: "A page with no description", url: "https://example.org/plain", snippet: "" },
    { title: "Pricing for the paid plan", url: "https://example.org/pricing?plan=paid&x=1", snippet: "Five dollars a month." },
  ]);

  let many = "";
  for (let number = 1; number <= 9; number++) many += duckResult(`Result number ${number}`, `https://site${number}.example/`, "Text.");
  assert.equal(parseDuckHtml(many).length, 6, "six results at most");
  assert.deepEqual(parseDuckHtml("<html><body>No results.</body></html>"), []);
  assert.deepEqual(parseDuckHtml(null), []);
});

test("only ordinary public web addresses are allowed", () => {
  const allowed = [
    "https://example.com/",
    "http://example.com:8080/path?x=1",
    "https://sub.example.co.uk/a/b",
    "https://example.com./",
    "https://8.8.8.8/",
    "http://172.32.0.1/",
    "http://100.128.0.1/",
    "http://192.169.0.1/",
  ];
  const refused = [
    "",
    "not an address",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:secret@example.com/",
    "http://localhost/",
    "http://localhost:8787/admin",
    "http://app.localhost/",
    "http://printer/",
    "http://router.local/",
    "http://db.internal/",
    "http://nas.lan/",
    "http://0.0.0.0/",
    "http://127.0.0.1/",
    "http://2130706433/", // 127.0.0.1 written as one number
    "http://0x7f.0.0.1/", // 127.0.0.1 written in hexadecimal
    "http://10.1.2.3/",
    "http://100.64.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://[::1]/",
    "http://[2001:db8::1]/",
  ];
  for (const address of allowed) assert.equal(isPublicUrl(address), true, address);
  for (const address of refused) assert.equal(isPublicUrl(address), false, address || "(empty)");
});

test("search takes the first engine that finds enough", async () => {
  const send = fakeFetch([
    [LITE, () => reply(resultsPage(1))],
    [BING, () => reply("slow down", { status: 429 })],
    [DUCK, () => reply(resultsPage(3))],
  ]);
  const found = await createWeb({ fetch: send }).search("free plan limits");
  assert.equal(found.via, "jina:html.duckduckgo.com");
  assert.equal(found.results.length, 3);
  assert.deepEqual(found.results[0], {
    title: "Result number 1 about the free plan",
    url: "https://site1.example/page",
    snippet: "Snippet 1.",
  });
  assert.deepEqual(found.tried, [
    { id: "jina:lite.duckduckgo.com", ok: false, results: 1 },
    { id: "jina:www.bing.com", ok: false, error: "HTTP 429" },
    { id: "jina:html.duckduckgo.com", ok: true, results: 3 },
  ]);
  assert.equal(send.calls[0].url, LITE + "free%20plan%20limits");
  assert.equal(send.calls[0].headers["X-Return-Format"], "markdown");
  assert.equal(send.count(DUCK_DIRECT), 0, "the later routes are not touched once one works");
  assert.equal(send.count(WIKIPEDIA), 0);
});

test("when the reader is blocked DuckDuckGo is asked directly", async () => {
  const page = duckResult("First real result", "https://one.example/", "One.") + duckResult("Second real result", "https://two.example/", "Two.");
  const send = fakeFetch([
    [READER, () => reply("forbidden", { status: 403 })],
    [DUCK_DIRECT, () => reply(page, HTML)],
  ]);
  const found = await createWeb({ fetch: send }).search("anything at all");
  assert.equal(found.via, "duckduckgo-direct");
  assert.deepEqual(
    found.results.map((result) => result.url),
    ["https://one.example/", "https://two.example/"],
  );
  const direct = send.calls.find((call) => call.url.startsWith(DUCK_DIRECT));
  assert.match(direct.headers["User-Agent"], /GlowBot/, "the bot says who it is");
});

test("Wikipedia is the last resort, and one article is enough", async () => {
  const article = { title: "Cloudflare Workers", snippet: 'A <span class="searchmatch">serverless</span> platform' };
  const send = fakeFetch([
    [READER, () => reply("nothing that looks like a result")],
    [DUCK_DIRECT, () => reply("forbidden", { status: 403 })],
    [WIKIPEDIA, () => reply({ query: { search: [article] } })],
  ]);
  const found = await createWeb({ fetch: send }).search("cloudflare workers");
  assert.equal(found.via, "wikipedia");
  assert.deepEqual(found.results, [
    { title: "Cloudflare Workers", url: "https://en.wikipedia.org/wiki/Cloudflare_Workers", snippet: "A serverless platform" },
  ]);
  assert.deepEqual(
    found.tried.map((attempt) => attempt.id),
    ["jina:lite.duckduckgo.com", "jina:www.bing.com", "jina:html.duckduckgo.com", "duckduckgo-direct", "wikipedia"],
  );
  assert.deepEqual(found.tried[3], { id: "duckduckgo-direct", ok: false, error: "HTTP 403" });
});

test("when nothing is found search says so instead of failing", async () => {
  const send = fakeFetch([]);
  const found = await createWeb({ fetch: send }).search("no route answers");
  assert.deepEqual(found.results, []);
  assert.equal(found.via, "");
  assert.equal(found.tried.length, 5);
  assert.ok(found.tried.every((attempt) => attempt.ok === false && attempt.error === "HTTP 599"));
});

test("a route that never answers is given up on, and the next one is tried", async () => {
  const send = fakeFetch([
    [READER, hangUntilAborted],
    [DUCK_DIRECT, hangUntilAborted],
    [WIKIPEDIA, () => reply({ query: { search: [{ title: "Patience", snippet: "" }] } })],
  ]);
  const found = await createWeb({ fetch: send, timeoutMs: 20 }).search("patience");
  assert.equal(found.via, "wikipedia");
  assert.ok(found.tried.slice(0, 4).every((attempt) => /^web search timed out/.test(attempt.error)));
});

test("a stop request ends the search at once", async () => {
  const send = fakeFetch([[READER, hangUntilAborted]]);
  const web = createWeb({ fetch: send });

  const before = new AbortController();
  before.abort();
  await assert.rejects(web.search("stopped before it starts", before.signal), StoppedError);
  assert.equal(send.calls.length, 0);

  const during = new AbortController();
  const searching = web.search("stopped half way", during.signal);
  setTimeout(() => during.abort(), 10);
  await assert.rejects(searching, StoppedError);
  assert.equal(send.calls.length, 1, "the other engines are not asked after a stop");
});

test("a page is read through the reader first", async () => {
  const send = fakeFetch([[READER, () => reply("Title\n\n\n\n\nBody text\n")]]);
  const page = await createWeb({ fetch: send }).read("https://example.org/a?b=1");
  assert.deepEqual(page, { text: "Title\n\nBody text", via: "jina" });
  assert.equal(send.calls[0].url, READER + "https://example.org/a?b=1");
  assert.equal(send.calls[0].headers["X-Return-Format"], "text");
});

test("when the reader fails the page is fetched directly and turned into text", async () => {
  const send = fakeFetch([
    [READER, () => reply("unavailable for legal reasons", { status: 451 })],
    ["https://example.org/", () => reply("<html><body><h1>Prices</h1><p>From $5 a month.</p></body></html>", HTML)],
  ]);
  const page = await createWeb({ fetch: send }).read("https://example.org/prices");
  assert.deepEqual(page, { text: "Prices\nFrom $5 a month.", via: "direct" });
  assert.match(send.calls[1].headers["User-Agent"], /GlowBot/);
});

test("an empty page from the reader is not an answer", async () => {
  const send = fakeFetch([
    [READER, () => reply("   \n  ")],
    ["https://example.org/", () => reply('{"price": 5}', { headers: { "Content-Type": "application/json" } })],
  ]);
  const page = await createWeb({ fetch: send }).read("https://example.org/data.json");
  assert.deepEqual(page, { text: '{"price": 5}', via: "direct" }, "text that is not HTML is passed on as it is");
});

test("a file that is not text is refused, with the reason for each route", async () => {
  const send = fakeFetch([
    [READER, () => reply("broken", { status: 500 })],
    ["https://example.org/", () => reply(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } })],
  ]);
  await assert.rejects(createWeb({ fetch: send }).read("https://example.org/logo.png"), (error) => {
    assert.ok(error instanceof WebError);
    assert.equal(error.message, "Could not read https://example.org/logo.png (jina: HTTP 500; direct: not a text page (image/png))");
    return true;
  });
});

test("private addresses are refused before anything is fetched", async () => {
  const send = fakeFetch([[READER, () => reply("should never be asked")]]);
  const web = createWeb({ fetch: send });
  for (const address of ["http://192.168.1.1/admin", "http://localhost:8787/", "file:///etc/passwd"]) {
    await assert.rejects(web.read(address), (error) => {
      assert.ok(error instanceof WebError);
      assert.equal(error.message, "That is not a public web address");
      return true;
    });
  }
  assert.equal(send.calls.length, 0);
});

test("a long page is cut and says so", async () => {
  const send = fakeFetch([[READER, () => reply("word ".repeat(200))]]);
  const page = await createWeb({ fetch: send }).read("https://example.org/long", undefined, 100);
  assert.equal(page.text, "word ".repeat(20) + "\n…[truncated]");
});

test("a huge download stops at the size limit", async () => {
  let sent = 0;
  let cancelled = false;
  const endless = new ReadableStream({
    pull(controller) {
      sent += 1;
      controller.enqueue(new Uint8Array(300000).fill(97));
      if (sent >= 20) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const send = fakeFetch([["https://big.example/", () => new Response(endless, { headers: { "Content-Type": "text/plain" } })]]);
  const direct = createWeb({ fetch: send }).readers.find((reader) => reader.id === "direct");
  const text = await direct.run("https://big.example/file.txt");
  assert.equal(text.length, 1500000);
  assert.ok(cancelled, "the rest of the download is cancelled");
  assert.ok(sent < 20, "the whole file is never read");
});

test("a reply without a stream is read whole and cut to the limit", async () => {
  const plain = {
    ok: true,
    status: 200,
    headers: { get: () => "text/plain" },
    text: async () => "b".repeat(1600000),
  };
  const send = fakeFetch([["https://old.example/", () => plain]]);
  const direct = createWeb({ fetch: send }).readers.find((reader) => reader.id === "direct");
  assert.equal((await direct.run("https://old.example/file.txt")).length, 1500000);
});

test("a page that starts arriving and then stalls is given up on", async () => {
  function stalled(url, init) {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<html><body>The first part"));
        init.signal.addEventListener("abort", () => controller.error(new DOMException("This operation was aborted", "AbortError")));
      },
    });
    return new Response(body, HTML);
  }
  const send = fakeFetch([
    [READER, stalled],
    ["https://slow.example/", stalled],
  ]);
  await assert.rejects(createWeb({ fetch: send, timeoutMs: 20 }).read("https://slow.example/page"), (error) => {
    assert.ok(error instanceof WebError);
    assert.match(error.message, /jina: page read timed out.*direct: page read timed out/);
    return true;
  });
});

test("GlowNews is read from the Glow site", async () => {
  const edition = { version: 1, briefing: { headline: "Today" }, stories: [{ id: "a", title: "One" }, { id: "b", title: "Two" }] };
  const send = fakeFetch([["https://glow.test/projects/glow/news/news.json", () => reply(edition)]]);
  const web = createWeb({ fetch: send, glowPages: "https://glow.test/projects/glow/" });
  assert.deepEqual(await web.news(), edition);
  assert.equal(send.calls[0].url, "https://glow.test/projects/glow/news/news.json");
});

test("a broken GlowNews edition is reported in plain words", async () => {
  const failing = [
    [() => reply("gone", { status: 404 }), "GlowNews answered HTTP 404", 404],
    [() => reply("<html>maintenance</html>"), "GlowNews did not send JSON", 0],
    [() => reply({ version: 1 }), "GlowNews has no stories", 0],
  ];
  for (const [handler, message, status] of failing) {
    const web = createWeb({ fetch: fakeFetch([["https://glow.test/news/news.json", handler]]), glowPages: "https://glow.test" });
    await assert.rejects(web.news(), (error) => {
      assert.ok(error instanceof WebError);
      assert.equal(error.message, message);
      assert.equal(error.status, status);
      return true;
    });
  }
});
