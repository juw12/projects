// How GlowBot reaches the web: search, read one page, and fetch the GlowNews edition.
//
// Search and reading go through the same free reader GlowRoom uses first, then fall back to asking the
// site directly, so one blocked route does not stop Scout. Every route is listed by name (`searchers`,
// `readers`) so the health check can try each one on its own and report which really work from Cloudflare.

import { SEARCH_ENGINES, SEARCH_ENGINE_HOSTS, decodeResultUrl, parseSearchMarkdown, truncate } from "./crew-port.js";
import { StoppedError, clip, errorText, withTimeout } from "./util.js";

// Honest about what is asking: a site that does not want bots can say no.
export const USER_AGENT = "Mozilla/5.0 (compatible; GlowBot/1.0; +https://juw12.github.io/projects/glow/bot/)";

const READER = "https://r.jina.ai/";
const WIKIPEDIA_SEARCH =
  "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=";
const MAX_PAGE_BYTES = 1500000;
const MAX_NEWS_BYTES = 4000000;
const MAX_RESULTS = 6;

export class WebError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "WebError";
    this.status = status || 0;
  }
}

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  euro: "€",
  pound: "£",
  yen: "¥",
};

// Turn &amp; &#39; &#x27; and friends into characters, in ONE pass so "&amp;lt;" stays "&lt;".
export function decodeEntities(text) {
  return String(text == null ? "" : text).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] !== "#") {
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? whole : named;
    }
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    const usable = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return usable ? String.fromCodePoint(code) : whole;
  });
}

const HIDDEN_ELEMENTS = /<(script|style|noscript|svg|head|template|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_ENDS =
  /<\/(?:p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|header|footer|main|nav|aside|dd|dt|figure|figcaption|form|title)\s*>/gi;

// The readable text of an HTML page: no scripts, styles or tags, one blank line at most between blocks.
export function htmlToText(html) {
  const withoutTags = String(html == null ? "" : html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(HIDDEN_ELEMENTS, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_ENDS, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags)
    .replace(/[ \t\f\v\r\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(html) {
  return htmlToText(html).replace(/\s+/g, " ").trim();
}

// DuckDuckGo's plain HTML results page -> [{ title, url, snippet }], the same shape parseSearchMarkdown gives.
export function parseDuckHtml(html) {
  const source = String(html == null ? "" : html);
  const results = [];
  const seen = new Set();
  const anchor = /<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while (results.length < MAX_RESULTS && (match = anchor.exec(source))) {
    const href = (match[1].match(/\bhref="([^"]*)"/i) || [])[1];
    if (!href) continue;
    let link = decodeEntities(href);
    if (link.startsWith("//")) link = "https:" + link;
    const url = decodeResultUrl(link);
    if (!url || !/^https?:\/\//.test(url)) continue;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch (error) {
      continue;
    }
    if (SEARCH_ENGINE_HOSTS.test(host) || /\/y\.js/.test(url) || seen.has(url)) continue;
    const title = oneLine(match[2]);
    if (title.length < 6) continue;
    // The snippet sits between this result's title and the next result's title.
    const after = source.slice(anchor.lastIndex, anchor.lastIndex + 6000);
    const nextTitle = after.search(/\bresult__a\b/);
    const own = nextTitle === -1 ? after : after.slice(0, nextTitle);
    const snippet = own.match(/\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i);
    seen.add(url);
    results.push({ title, url, snippet: snippet ? oneLine(snippet[1]).slice(0, 300) : "" });
  }
  return results;
}

// A search engine's RSS answer (RSS 2.0 <item> blocks) -> [{ title, url, snippet }].
export function parseRss(xml) {
  const source = String(xml == null ? "" : xml);
  const results = [];
  const seen = new Set();
  const item = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  let match;
  while (results.length < MAX_RESULTS && (match = item.exec(source))) {
    const body = match[1];
    // CDATA content is already plain; anything else is escaped once, so it is decoded once.
    const field = (name) => {
      const found = body.match(new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)</" + name + "\\s*>", "i"));
      if (!found) return "";
      const cdata = found[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
      return cdata ? cdata[1] : decodeEntities(found[1]);
    };
    const url = field("link").trim();
    if (!isPublicUrl(url) || seen.has(url)) continue;
    if (SEARCH_ENGINE_HOSTS.test(new URL(url).hostname)) continue;
    const title = oneLine(field("title"));
    if (title.length < 3) continue;
    seen.add(url);
    results.push({ title, url, snippet: oneLine(field("description")).slice(0, 300) });
  }
  return results;
}

// The page's own <title>, which htmlToText drops along with the rest of <head>.
function titleOf(html) {
  const source = String(html == null ? "" : html);
  const bodyAt = source.search(/<body\b/i);
  const head = bodyAt === -1 ? source.slice(0, 20000) : source.slice(0, bodyAt);
  const found = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return found ? oneLine(found[1]).slice(0, 200) : "";
}

// True only for an ordinary public http(s) address. The bot fetches addresses that models and users give
// it, so anything that points at a private network, a bare machine name or a login is refused.
export function isPublicUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (error) {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":") || host.startsWith("[")) return false; // IPv6 literals
  if (host === "localhost" || /\.(?:localhost|local|internal|lan|home\.arpa)$/.test(host)) return false;
  if (!host.includes(".")) return false; // a single-label name is a machine on a local network
  const quad = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (quad) {
    const parts = quad.slice(1).map(Number);
    const [a, b] = parts;
    if (parts.some((part) => part > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this-network, private, loopback, multicast
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  }
  return true;
}

// Read a response body as text, stopping at maxBytes so one huge page cannot fill the Worker's memory.
async function readBody(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    return (await response.text()).slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let received = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    received += part.value.length;
    text += decoder.decode(part.value, { stream: true });
    if (received >= maxBytes) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  // One chunk can carry the reading past the limit, so the text is cut to it as well.
  return (text + decoder.decode()).slice(0, maxBytes);
}

// createWeb({ fetch, timeoutMs, userAgent, glowPages }) -> { search, read, news, searchers, readers }
export function createWeb(options) {
  const settings = options || {};
  const send = settings.fetch || ((input, init) => fetch(input, init));
  const timeoutMs = settings.timeoutMs || 20000;
  const userAgent = settings.userAgent || USER_AGENT;
  const glowPages = String(settings.glowPages || "https://juw12.github.io/projects/glow").replace(/\/+$/, "");

  // One GET. The time limit covers the body too: a page can start arriving and then stall.
  function get(url, headers, signal, label, maxBytes) {
    return withTimeout(
      async (inner) => {
        const response = await send(url, { headers, signal: inner });
        return {
          ok: response.ok,
          status: response.status,
          type: response.headers.get("Content-Type") || "",
          text: await readBody(response, maxBytes || MAX_PAGE_BYTES),
        };
      },
      timeoutMs,
      label,
      signal,
    );
  }

  // GlowRoom's three engines, each read through the free reader (the order GlowRoom tries them in).
  const searchers = SEARCH_ENGINES.map((engine) => ({
    id: "jina:" + new URL(engine("x")).hostname,
    async run(query, signal) {
      const reply = await get(READER + engine(query), { "X-Return-Format": "markdown" }, signal, "web search");
      if (!reply.ok) throw new WebError(`HTTP ${reply.status}`, reply.status);
      return parseSearchMarkdown(reply.text);
    },
  }));
  searchers.push({
    id: "duckduckgo-direct",
    async run(query, signal) {
      const address = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const reply = await get(address, { "User-Agent": userAgent, Accept: "text/html" }, signal, "web search");
      if (!reply.ok) throw new WebError(`HTTP ${reply.status}`, reply.status);
      return parseDuckHtml(reply.text);
    },
  });
  searchers.push({
    id: "bing-rss",
    async run(query, signal) {
      const address = "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(query);
      const headers = {
        "User-Agent": userAgent,
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      };
      const reply = await get(address, headers, signal, "web search");
      if (!reply.ok) throw new WebError(`HTTP ${reply.status}`, reply.status);
      return parseRss(reply.text);
    },
  });
  searchers.push({
    id: "wikipedia",
    lastResort: true, // GlowRoom takes whatever Wikipedia finds, even a single article
    async run(query, signal) {
      const address = WIKIPEDIA_SEARCH + encodeURIComponent(query);
      const reply = await get(address, { "User-Agent": userAgent }, signal, "web search");
      if (!reply.ok) throw new WebError(`HTTP ${reply.status}`, reply.status);
      const found = JSON.parse(reply.text);
      return ((found.query && found.query.search) || []).map((hit) => ({
        title: hit.title,
        url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(hit.title).replace(/ /g, "_")),
        snippet: String(hit.snippet || "").replace(/<[^>]+>/g, ""),
      }));
    },
  });

  // search(query, signal) -> { results: [{ title, url, snippet }], via, tried }
  async function search(query, signal) {
    const tried = [];
    for (const searcher of searchers) {
      if (signal && signal.aborted) throw new StoppedError();
      try {
        const results = await searcher.run(query, signal);
        const enough = results.length >= (searcher.lastResort ? 1 : 2);
        tried.push({ id: searcher.id, ok: enough, results: results.length });
        if (enough) return { results, via: searcher.id, tried };
      } catch (error) {
        if (error instanceof StoppedError) throw error;
        tried.push({ id: searcher.id, ok: false, error: clip(errorText(error), 120) });
      }
    }
    return { results: [], via: "", tried };
  }

  const readers = [
    {
      id: "jina",
      async run(url, signal) {
        const reply = await get(READER + url, { "X-Return-Format": "text" }, signal, "page read");
        if (!reply.ok) throw new WebError(`HTTP ${reply.status}`, reply.status);
        return reply.text;
      },
    },
    {
      id: "direct",
      async run(url, signal) {
        const headers = { "User-Agent": userAgent, Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" };
        const reply = await get(url, headers, signal, "page read");
        if (!reply.ok) throw new WebError(`HTTP ${reply.status}`, reply.status);
        if (reply.type && !/^(?:text\/|application\/(?:json|xml|xhtml\+xml|[a-z.+-]*\+(?:json|xml)))/i.test(reply.type)) {
          throw new WebError(`not a text page (${clip(reply.type, 40)})`, reply.status);
        }
        const looksLikeHtml = /html/i.test(reply.type) || /<(?:!doctype html|html|body)\b/i.test(reply.text.slice(0, 2000));
        if (!looksLikeHtml) return reply.text;
        const text = htmlToText(reply.text);
        const title = titleOf(reply.text);
        return title && !text.startsWith(title) ? `${title}\n\n${text}` : text;
      },
    },
  ];

  // read(url, signal, maxChars) -> { text, via }
  async function read(url, signal, maxChars = 40000) {
    if (!isPublicUrl(url)) throw new WebError("That is not a public web address");
    const failures = [];
    for (const reader of readers) {
      if (signal && signal.aborted) throw new StoppedError();
      try {
        const page = String(await reader.run(url, signal)).replace(/\n{3,}/g, "\n\n").trim();
        if (page) return { text: truncate(page, maxChars), via: reader.id };
        failures.push(`${reader.id}: empty page`);
      } catch (error) {
        if (error instanceof StoppedError) throw error;
        failures.push(`${reader.id}: ${clip(errorText(error), 100)}`);
      }
    }
    throw new WebError(`Could not read ${url} (${failures.join("; ")})`);
  }

  // The current GlowNews edition, exactly as the GlowNews page reads it.
  async function news(signal) {
    const reply = await get(glowPages + "/news/news.json", {}, signal, "GlowNews", MAX_NEWS_BYTES);
    if (!reply.ok) throw new WebError(`GlowNews answered HTTP ${reply.status}`, reply.status);
    let edition = null;
    try {
      edition = JSON.parse(reply.text);
    } catch (error) {
      throw new WebError("GlowNews did not send JSON");
    }
    if (!edition || !Array.isArray(edition.stories)) throw new WebError("GlowNews has no stories");
    return edition;
  }

  return { search, read, news, searchers, readers };
}
