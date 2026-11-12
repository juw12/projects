import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSearchMarkdown } from "../src/crew-port.js";
import { StoppedError } from "../src/util.js";
import { WebError, createWeb, decodeEntities, htmlToText, isPublicUrl, parseDuckHtml, parseRss } from "../src/web.js";
import { fakeFetch, reply } from "./fakes.js";

const READER = "https://r.jina.ai/";
const DUCK_DIRECT = "https://html.duckduckgo.com/html/?q=";
const BING_RSS = "https://www.bing.com/search?format=rss&q=";
const WIKIPEDIA = "https://en.wikipedia.org/w/api.php";
const HTML = { headers: { "Content-Type": "text/html; charset=utf-8" } };
const RSS = { headers: { "Content-Type": "text/xml; charset=utf-8" } };

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

// A search engine's RSS answer: each item is { title, link, description }, written out as it is given.
function rssFeed(items) {
  const body = items
    .map((item) => `<item><title>${item.title}</title><link>${item.link}</link><description>${item.description || ""}</description></item>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Search</title>` +
    `<link>https://www.bing.com/search?q=x</link><description>Search results</description>\n${body}\n</channel></rss>`;
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

test("results are read from a search engine's RSS answer", () => {
  const feed = rssFeed([
    {
      title: "Limits &amp; pricing &#183; Cloudflare Workers docs",
      link: "https://developers.cloudflare.com/workers/platform/limits/?a=1&amp;b=2",
      description: "The free plan allows 100,000 requests per day &amp; 10 ms of CPU.",
    },
    {
      title: "<![CDATA[Workers <b>pricing</b> & plans]]>",
      link: "<![CDATA[https://example.org/pricing?plan=free&x=1]]>",
      description: "<![CDATA[Free, then <b>five dollars</b> a month.]]>",
    },
    { title: "The first page once more", link: "https://example.org/pricing?plan=free&amp;x=1", description: "Seen already." },
    { title: "A machine on somebody's own network", link: "http://192.168.1.1/admin", description: "Not public." },
    { title: "The search engine itself", link: "https://www.bing.com/search?q=more", description: "More results." },
    { title: "No", link: "https://example.org/short", description: "The title is too short to be a real result." },
    { title: "A result with no description", link: "https://example.org/plain" },
  ]);
  assert.deepEqual(parseRss(feed), [
    {
      title: "Limits & pricing · Cloudflare Workers docs",
      url: "https://developers.cloudflare.com/workers/platform/limits/?a=1&b=2",
      snippet: "The free plan allows 100,000 requests per day & 10 ms of CPU.",
    },
    { title: "Workers pricing & plans", url: "https://example.org/pricing?plan=free&x=1", snippet: "Free, then five dollars a month." },
    { title: "A result with no description", url: "https://example.org/plain", snippet: "" },
  ]);

  const many = [];
  for (let number = 1; number <= 9; number++) {
    many.push({ title: `Result number ${number}`, link: `https://site${number}.example/`, description: "Text." });
  }
  assert.equal(parseRss(rssFeed(many)).length, 6, "six results at most");
  assert.deepEqual(parseRss(rssFeed([])), [], "the feed's own title and link are not a result");
  assert.deepEqual(parseRss("<html><body>Not a feed.</body></html>"), []);
  assert.deepEqual(parseRss(null), []);
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

test("search asks Bing's RSS answer first", async () => {
  const feed = rssFeed([
    { title: "First real result", link: "https://one.example/", description: "One." },
    { title: "Second real result", link: "https://two.example/", description: "Two." },
  ]);
  const send = fakeFetch([
    [BING_RSS, () => reply(feed, RSS)],
    [WIKIPEDIA, () => reply({ query: { search: [{ title: "Not needed", snippet: "" }] } })],
  ]);
  const found = await createWeb({ fetch: send }).search("free plan limits");
  assert.equal(found.via, "bing-rss");
  assert.deepEqual(found.results, [
    { title: "First real result", url: "https://one.example/", snippet: "One." },
    { title: "Second real result", url: "https://two.example/", snippet: "Two." },
  ]);
  assert.deepEqual(found.tried, [{ id: "bing-rss", ok: true, results: 2 }]);
  assert.equal(send.calls.length, 1);
  assert.equal(send.calls[0].url, BING_RSS + "free%20plan%20limits");
  assert.match(send.calls[0].headers["User-Agent"], /GlowBot/, "the bot says who it is");
  assert.equal(send.count(WIKIPEDIA), 0, "the last resort is not touched once a real search works");
});

test("one result is not enough for a real search, so Wikipedia is asked as well", async () => {
  const feed = rssFeed([{ title: "The only result", link: "https://one.example/", description: "One." }]);
  const article = { title: "Cloudflare Workers", snippet: 'A <span class="searchmatch">serverless</span> platform' };
  const send = fakeFetch([
    [BING_RSS, () => reply(feed, RSS)],
    [WIKIPEDIA, () => reply({ query: { search: [article] } })],
  ]);
  const found = await createWeb({ fetch: send }).search("cloudflare workers");
  assert.equal(found.via, "wikipedia");
  assert.deepEqual(found.results, [
    { title: "Cloudflare Workers", url: "https://en.wikipedia.org/wiki/Cloudflare_Workers", snippet: "A serverless platform" },
  ]);
  assert.deepEqual(found.tried, [
    { id: "bing-rss", ok: false, results: 1 },
    { id: "wikipedia", ok: true, results: 1 },
  ]);
});

test("when Bing refuses, Wikipedia is the last resort and one article is enough", async () => {
  const send = fakeFetch([
    [BING_RSS, () => reply("slow down", { status: 429 })],
    [WIKIPEDIA, () => reply({ query: { search: [{ title: "Patience (game)", snippet: "A card game" }] } })],
  ]);
  const found = await createWeb({ fetch: send }).search("patience");
  assert.equal(found.via, "wikipedia");
  assert.deepEqual(found.results, [
    { title: "Patience (game)", url: "https://en.wikipedia.org/wiki/Patience_(game)", snippet: "A card game" },
  ]);
  assert.deepEqual(found.tried, [
    { id: "bing-rss", ok: false, error: "HTTP 429" },
    { id: "wikipedia", ok: true, results: 1 },
  ]);
  const asked = send.calls.find((call) => call.url.startsWith(WIKIPEDIA));
  assert.match(asked.headers["User-Agent"], /GlowBot/, "the bot says who it is");
});

test("the routes that turn Cloudflare away are not in the chain", async () => {
  const send = fakeFetch([]);
  const web = createWeb({ fetch: send });
  assert.deepEqual(
    web.searchers.map((searcher) => searcher.id),
    ["bing-rss", "wikipedia"],
  );
  assert.deepEqual(
    web.readers.map((reader) => reader.id),
    ["direct", "jina"],
    "the site itself is asked before the free reader",
  );
  await web.search("anything at all");
  assert.equal(send.count(READER), 0, "the free reader is never asked to search");
  assert.equal(send.count(DUCK_DIRECT), 0, "DuckDuckGo is never asked");
});

test("when nothing is found search says so instead of failing", async () => {
  const send = fakeFetch([]);
  const found = await createWeb({ fetch: send }).search("no route answers");
  assert.deepEqual(found.results, []);
  assert.equal(found.via, "");
  assert.equal(found.tried.length, 2);
  assert.ok(found.tried.every((attempt) => attempt.ok === false && attempt.error === "HTTP 599"));
});

test("a route that never answers is given up on, and the next one is tried", async () => {
  const send = fakeFetch([
    [BING_RSS, hangUntilAborted],
    [WIKIPEDIA, () => reply({ query: { search: [{ title: "Patience", snippet: "" }] } })],
  ]);
  const found = await createWeb({ fetch: send, timeoutMs: 20 }).search("patience");
  assert.equal(found.via, "wikipedia");
  assert.equal(found.tried.length, 2);
  assert.equal(found.tried[0].id, "bing-rss");
  assert.match(found.tried[0].error, /^web search timed out/);
});

test("a stop request ends the search at once", async () => {
  const send = fakeFetch([[BING_RSS, hangUntilAborted]]);
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

test("a page is read from the site itself first", async () => {
  const send = fakeFetch([
    ["https://example.org/", () => reply("<html><body><h1>Prices</h1><p>From $5 a month.</p></body></html>", HTML)],
    [READER, () => reply("should not be needed")],
  ]);
  const page = await createWeb({ fetch: send }).read("https://example.org/prices?b=1");
  assert.deepEqual(page, { text: "Prices\nFrom $5 a month.", via: "direct" });
  assert.equal(send.calls.length, 1);
  assert.equal(send.calls[0].url, "https://example.org/prices?b=1");
  assert.match(send.calls[0].headers["User-Agent"], /GlowBot/, "the bot says who it is");
  assert.equal(send.count(READER), 0, "the free reader is not touched when the site answers");
});

test("when the site refuses, the free reader is tried", async () => {
  const send = fakeFetch([
    ["https://example.org/", () => reply("unavailable for legal reasons", { status: 451 })],
    [READER, () => reply("Title\n\n\n\n\nBody text\n")],
  ]);
  const page = await createWeb({ fetch: send }).read("https://example.org/a?b=1");
  assert.deepEqual(page, { text: "Title\n\nBody text", via: "jina" });
  assert.equal(send.calls[1].url, READER + "https://example.org/a?b=1");
  assert.equal(send.calls[1].headers["X-Return-Format"], "text");
});

test("a page read directly starts with its own title", async () => {
  const page =
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Example  Domain &amp; friends</title>" +
    "<style>p { color: red }</style></head><body><p>This domain is for use in documentation examples.</p></body></html>";
  const titledTwice =
    "<html><head><title>Prices</title></head><body><h1>Prices</h1><p>From $5 a month.</p></body></html>";
  const titleInBody = "<html><body><p>An article quoting <title>not the page title</title> in its text.</p></body></html>";
  const send = fakeFetch([
    ["https://example.org/titled", () => reply(page, HTML)],
    ["https://example.org/twice", () => reply(titledTwice, HTML)],
    ["https://example.org/body", () => reply(titleInBody, HTML)],
  ]);
  const web = createWeb({ fetch: send });
  assert.deepEqual(await web.read("https://example.org/titled"), {
    text: "Example Domain & friends\n\nThis domain is for use in documentation examples.",
    via: "direct",
  });
  assert.equal((await web.read("https://example.org/twice")).text, "Prices\nFrom $5 a month.", "a title the page repeats is not added again");
  assert.equal(
    (await web.read("https://example.org/body")).text,
    "An article quoting not the page title\nin its text.",
    "only a title in the head counts",
  );
});

test("an empty page from the site is not an answer", async () => {
  const send = fakeFetch([
    ["https://example.org/", () => reply("   \n  ", { headers: { "Content-Type": "text/plain" } })],
    [READER, () => reply("The text the reader found")],
  ]);
  const page = await createWeb({ fetch: send }).read("https://example.org/empty");
  assert.deepEqual(page, { text: "The text the reader found", via: "jina" });
});

test("text that is not HTML is passed on as it is", async () => {
  const send = fakeFetch([
    ["https://example.org/", () => reply('{"price": 5}', { headers: { "Content-Type": "application/json" } })],
  ]);
  const page = await createWeb({ fetch: send }).read("https://example.org/data.json");
  assert.deepEqual(page, { text: '{"price": 5}', via: "direct" });
});

test("a file that is not text is refused, with the reason for each route", async () => {
  const send = fakeFetch([
    [READER, () => reply("broken", { status: 500 })],
    ["https://example.org/", () => reply(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } })],
  ]);
  await assert.rejects(createWeb({ fetch: send }).read("https://example.org/logo.png"), (error) => {
    assert.ok(error instanceof WebError);
    assert.equal(error.message, "Could not read https://example.org/logo.png (direct: not a text page (image/png); jina: HTTP 500)");
    return true;
  });
});

test("private addresses are refused before anything is fetched", async () => {
  const send = fakeFetch([
    ["http", () => reply("should never be asked")],
    ["file", () => reply("should never be asked")],
  ]);
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
  const send = fakeFetch([
    ["https://example.org/", () => reply("word ".repeat(200), { headers: { "Content-Type": "text/plain" } })],
  ]);
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
    assert.match(error.message, /direct: page read timed out.*jina: page read timed out/);
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
