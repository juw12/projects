// Checks for src/telegram.js: Markdown to Telegram HTML, cutting long answers, and the Bot API client.
import test from "node:test";
import assert from "node:assert/strict";

import {
  API_BASE,
  MESSAGE_LIMIT,
  QUOTE_LIMIT,
  createTelegram,
  htmlToPlain,
  httpTransport,
  inlineMd,
  keyboard,
  mdToBlocks,
  mdToMessages,
  packBlocks,
  quoteMessages,
  recordingTransport,
  scrubToken,
} from "../src/telegram.js";
import { fakeFetch, reply } from "./fakes.js";

const TOKEN = "123456789:AAExampleTokenThatIsNotRealAtAll_0123456";

// An independent reading of "is this HTML safe to send": every tag closes in order, and no stray < or >.
function tagProblems(html) {
  const open = [];
  let rest = html;
  for (;;) {
    const at = rest.search(/[<>]/);
    if (at === -1) break;
    if (rest[at] === ">") return "a stray > in " + JSON.stringify(html.slice(0, 80));
    const end = rest.indexOf(">", at);
    if (end === -1) return "a tag that never ends in " + JSON.stringify(html.slice(0, 80));
    const inside = rest.slice(at + 1, end);
    const name = (inside.match(/^\/?([a-zA-Z][a-zA-Z0-9-]*)/) || [])[1];
    if (!name) return "a stray < in " + JSON.stringify(html.slice(0, 80));
    if (inside.startsWith("/")) {
      if (open.pop() !== name) return "a closing tag out of order: " + name;
    } else {
      open.push(name);
    }
    rest = rest.slice(end + 1);
  }
  return open.length ? "left open: " + open.join(", ") : "";
}

test("inlineMd turns the common Markdown marks into Telegram tags", () => {
  assert.equal(inlineMd("**bold** and *italic* and `code`"), "<b>bold</b> and <i>italic</i> and <code>code</code>");
  assert.equal(inlineMd("__bold__ and _italic_ and ~~gone~~"), "<b>bold</b> and <i>italic</i> and <s>gone</s>");
  assert.equal(inlineMd("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  assert.equal(inlineMd("use `a < b && c` here"), "use <code>a &lt; b &amp;&amp; c</code> here");
  assert.equal(inlineMd("**see `x`**"), "<b>see <code>x</code></b>");
  assert.equal(inlineMd(""), "");
  assert.equal(inlineMd(null), "");
});

test("inlineMd leaves arithmetic, snake_case and lone marks alone", () => {
  assert.equal(inlineMd("2 * 3 * 4 = 24"), "2 * 3 * 4 = 24");
  assert.equal(inlineMd("snake_case_name and file_name.py"), "snake_case_name and file_name.py");
  assert.equal(inlineMd("5*3*2"), "5*3*2");
  assert.equal(inlineMd("a ** b"), "a ** b");
  assert.equal(inlineMd("one * star"), "one * star");
  assert.equal(inlineMd("`**not bold**`"), "<code>**not bold**</code>");
});

test("inlineMd keeps links, and only http, https and tg addresses become links", () => {
  assert.equal(
    inlineMd("[Batam](https://en.wikipedia.org/wiki/Batam_(city)) is an island"),
    '<a href="https://en.wikipedia.org/wiki/Batam_(city)">Batam</a> is an island',
  );
  assert.equal(inlineMd("[a & b](https://x.test/?a=1&b=2)"), '<a href="https://x.test/?a=1&amp;b=2">a &amp; b</a>');
  assert.equal(inlineMd('[say "hi"](https://x.test/q?"x")'), '<a href="https://x.test/q?&quot;x&quot;">say "hi"</a>');
  assert.equal(inlineMd("[**Bold** label](https://x.test/)"), '<a href="https://x.test/">Bold label</a>');
  assert.equal(inlineMd("![a chart](https://x.test/c.png)"), '<a href="https://x.test/c.png">a chart</a>');
  assert.equal(inlineMd("[](https://x.test/)"), '<a href="https://x.test/">https://x.test/</a>');
  assert.equal(inlineMd("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
  assert.equal(inlineMd("[x](data:text/html,hi)"), "[x](data:text/html,hi)");
  assert.equal(inlineMd("[open](tg://resolve?domain=glow)"), '<a href="tg://resolve?domain=glow">open</a>');
});

test("inlineMd never reads emphasis inside a bare address", () => {
  assert.equal(
    inlineMd("_see_ https://example.com/a_b_c?x=1&y=2_z."),
    "<i>see</i> https://example.com/a_b_c?x=1&amp;y=2_z.",
  );
  assert.equal(inlineMd("(https://x.test/a_(b))"), "(https://x.test/a_(b))");
  assert.equal(inlineMd("**https://x.test/a*b**"), "<b>https://x.test/a*b</b>");
});

test("inlineMd always gives balanced tags, whatever a model writes", () => {
  const nasty = [
    "**bold *both** italic*",
    "__a **b__ c**",
    "**a __b** c__",
    "*a **b* c**",
    "~~a **b~~ c**",
    "<b>raw html</b> and <script>alert(1)</script>",
    "a `code with <b> and ** inside` b **bold `c` d**",
    "[label **x**](https://x.test/a_b) *and* _more_ ~~strike~~",
    "\u0001" + "0" + "\u0002 placeholder characters in the input",
    "**",
    "****",
    "__",
    "` ` `` ``",
    "*a*b*c*d*",
    "_a_b_c_d_",
    "[[nested]](https://x.test/) ](",
    "> < >> << & &amp; &lt;",
    "**bold with <angle> inside**",
  ];
  for (const line of nasty) {
    const html = inlineMd(line);
    assert.equal(tagProblems(html), "", `for ${JSON.stringify(line)} got ${JSON.stringify(html)}`);
    assert.ok(!/[\u0001\u0002]/.test(html), `placeholder left in ${JSON.stringify(html)}`);
  }
  assert.equal(inlineMd("<b>raw</b>"), "&lt;b&gt;raw&lt;/b&gt;");
});

test("mdToBlocks reads headings, lists, task boxes, rules and numbered lines", () => {
  const blocks = mdToBlocks(
    ["# Plan", "", "## **Step** one", "- first", "  - nested", "* [ ] to do", "- [x] done", "1. one", "2) two", "---", "plain **text**"].join(
      "\n",
    ),
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "text");
  assert.deepEqual(blocks[0].lines, [
    "<b>Plan</b>",
    "",
    "<b>Step one</b>",
    "• first",
    "  • nested",
    "☐ to do",
    "☑ done",
    "1. one",
    "2. two",
    "———",
    "plain <b>text</b>",
  ]);
});

test("mdToBlocks turns a table into rows a phone can read", () => {
  const blocks = mdToBlocks(["| Name | Price |", "|------|------:|", "| **A** | 10 |", "| B \\| C | 20 |"].join("\n"));
  assert.deepEqual(blocks, [{ type: "text", lines: ["<b>Name · Price</b>", "<b>A</b> · 10", "B | C · 20"] }]);
});

test("mdToBlocks keeps code and quotes as their own blocks", () => {
  const blocks = mdToBlocks(
    ["Before", "", "```js", "const a = 1 < 2;", "", "  **not bold**", "```", "", "> quoted **text**", "> second", "", "After"].join("\n"),
  );
  assert.deepEqual(blocks, [
    { type: "text", lines: ["Before"] },
    { type: "pre", lines: ["const a = 1 &lt; 2;", "", "  **not bold**"] },
    { type: "quote", lines: ["quoted <b>text</b>", "second"] },
    { type: "text", lines: ["After"] },
  ]);
});

test("mdToBlocks collapses blank lines and copes with nothing at all", () => {
  assert.deepEqual(mdToBlocks("a\n\n\n\nb\r\n\r\nc\n\n"), [{ type: "text", lines: ["a", "", "b", "", "c"] }]);
  assert.deepEqual(mdToBlocks(""), []);
  assert.deepEqual(mdToBlocks(null), []);
  assert.deepEqual(mdToBlocks("   \n\n  "), []);
  // A code fence the model forgot to close still ends up as code, not as lost text.
  assert.deepEqual(mdToBlocks("```\nleft open"), [{ type: "pre", lines: ["left open"] }]);
});

test("mdToMessages sends a short answer as one message", () => {
  assert.deepEqual(mdToMessages("# Hi\n\nThis is **fine**.\n\n```\ncode\n```"), ["<b>Hi</b>\n\nThis is <b>fine</b>.\n<pre>code</pre>"]);
  assert.deepEqual(mdToMessages(""), []);
  assert.deepEqual(mdToMessages("   "), []);
});

test("a long answer is cut into messages that each fit and each stand alone", () => {
  const lines = [];
  for (let index = 1; index <= 300; index++) lines.push(`- item ${index} with **bold** and \`code\` and a [link](https://x.test/${index})`);
  const limit = 1000;
  const messages = mdToMessages(lines.join("\n"), limit);
  assert.ok(messages.length > 10, `only ${messages.length} messages`);
  for (const message of messages) {
    assert.ok(message.length <= limit, `a message of ${message.length} characters`);
    assert.equal(tagProblems(message), "");
  }
  const all = messages.join("\n").split("\n");
  assert.equal(all.length, 300);
  assert.equal(all[0], '• item 1 with <b>bold</b> and <code>code</code> and a <a href="https://x.test/1">link</a>');
  assert.equal(all[299], '• item 300 with <b>bold</b> and <code>code</code> and a <a href="https://x.test/300">link</a>');
});

test("one enormous line is cut at spaces and loses nothing", () => {
  const words = [];
  for (let index = 0; index < 1500; index++) words.push(index % 7 === 0 ? "a<b&c" : "word" + index);
  const line = words.join(" ");
  assert.ok(line.length > 10000);
  const messages = mdToMessages(line, MESSAGE_LIMIT);
  assert.ok(messages.length >= 3);
  for (const message of messages) {
    assert.ok(message.length <= MESSAGE_LIMIT, `a message of ${message.length} characters`);
    assert.equal(tagProblems(message), "");
  }
  assert.equal(htmlToPlain(messages.join(" ")).replace(/\s+/g, " "), line);
});

test("a word longer than a whole message is cut by characters, never inside an emoji", () => {
  const giant = "😀".repeat(900) + "<".repeat(300);
  const messages = mdToMessages(giant, 500);
  for (const message of messages) {
    assert.ok(message.length <= 500, `a message of ${message.length} characters`);
    assert.ok(!/[\uD800-\uDBFF]$/.test(message) && !/^[\uDC00-\uDFFF]/.test(message), "an emoji was cut in half");
  }
  assert.equal(htmlToPlain(messages.join("")).replace(/\s+/g, ""), giant);
});

test("a long code block becomes several code blocks, one per message", () => {
  const code = [];
  for (let index = 0; index < 200; index++) code.push(`  if (a${index} < b && c > d) { run(${index}); }`);
  const messages = mdToMessages("Here:\n```js\n" + code.join("\n") + "\n```\nDone.", 800);
  assert.ok(messages.length > 5);
  for (const message of messages) {
    assert.ok(message.length <= 800, `a message of ${message.length} characters`);
    assert.equal(tagProblems(message), "");
  }
  assert.ok(messages[0].startsWith("Here:\n<pre>"));
  assert.ok(messages[1].startsWith("<pre>") && messages[1].endsWith("</pre>"));
  assert.ok(messages[messages.length - 1].endsWith("</pre>\nDone."));
  const joined = messages.join("\n");
  assert.equal((joined.match(/run\(\d+\)/g) || []).length, 200);
  assert.ok(joined.includes("if (a199 &lt; b &amp;&amp; c &gt; d) { run(199); }"));
});

test("a long quote is cut into quotes, and packBlocks tolerates odd input", () => {
  const quoted = [];
  for (let index = 0; index < 80; index++) quoted.push(`> quoted line number ${index}`);
  const messages = mdToMessages(quoted.join("\n"), 400);
  assert.ok(messages.length > 3);
  for (const message of messages) {
    assert.ok(message.length <= 400);
    assert.ok(message.startsWith("<blockquote>") && message.endsWith("</blockquote>"));
    assert.equal(tagProblems(message), "");
  }
  assert.deepEqual(packBlocks(null), []);
  assert.deepEqual(packBlocks([]), []);
  assert.deepEqual(packBlocks([{ type: "mystery", lines: ["kept as text"] }]), ["kept as text"]);
});

test("quoteMessages folds an agent's answer under its name", () => {
  const header = "🔎 <b>Scout</b>";
  assert.deepEqual(quoteMessages(header, "Batam is **near** Singapore."), [
    "🔎 <b>Scout</b>\n<blockquote expandable>Batam is <b>near</b> Singapore.</blockquote>",
  ]);
  assert.deepEqual(quoteMessages(header, ""), [header]);
  assert.deepEqual(quoteMessages(header, "> a quote inside\n\nand text"), [
    "🔎 <b>Scout</b>\n<blockquote expandable>▎ a quote inside\nand text</blockquote>",
  ]);
});

test("quoteMessages numbers the parts of a long answer and every part fits", () => {
  const lines = [];
  for (let index = 1; index <= 400; index++) lines.push(`Line ${index}: some **text** that fills the message up nicely.`);
  const header = "💻 <b>Byte</b> · step 2";
  const messages = quoteMessages(header, lines.join("\n"));
  assert.ok(messages.length >= 4, `only ${messages.length} parts`);
  messages.forEach((message, index) => {
    assert.ok(message.length <= QUOTE_LIMIT, `a part of ${message.length} characters`);
    assert.ok(message.startsWith(`${header} (${index + 1}/${messages.length})\n<blockquote expandable>`));
    assert.ok(message.endsWith("</blockquote>"));
    assert.equal(tagProblems(message), "");
    assert.equal((message.match(/<blockquote/g) || []).length, 1, "quotes cannot nest in Telegram");
  });
  assert.equal((messages.join("\n").match(/Line \d+:/g) || []).length, 400);
});

test("scrubToken removes the bot token however it shows up", () => {
  assert.equal(scrubToken(`failed: ${API_BASE}/bot${TOKEN}/sendMessage`, TOKEN), `failed: ${API_BASE}/bot<token>/sendMessage`);
  assert.equal(scrubToken(`failed: ${API_BASE}/bot${TOKEN}/sendMessage`), `failed: ${API_BASE}/bot<token>/sendMessage`);
  assert.equal(scrubToken(`the token ${TOKEN} leaked`), "the token <token> leaked");
  assert.equal(scrubToken("at 12:30 it rained 100:1"), "at 12:30 it rained 100:1");
  assert.equal(scrubToken(null), "");
});

test("htmlToPlain gives readable text back, with link addresses kept", () => {
  assert.equal(
    htmlToPlain('<b>Hi</b> <a href="https://x.test/?a=1&amp;b=2">the link</a> &lt;3 &amp; more'),
    "Hi the link (https://x.test/?a=1&b=2) <3 & more",
  );
  assert.equal(htmlToPlain('<a href="https://x.test/">https://x.test/</a>'), "https://x.test/");
  assert.equal(htmlToPlain("<blockquote expandable>quoted\n<code>x</code></blockquote>"), "quoted\nx");
  assert.equal(htmlToPlain("1 &lt; 2 and a < b"), "1 < 2 and a < b");
  assert.equal(htmlToPlain(null), "");
});

test("keyboard builds Telegram's button rows", () => {
  assert.deepEqual(
    keyboard([
      [
        { text: "Run", data: "run:j1" },
        { text: "Open", url: "https://x.test/" },
      ],
      { text: "App", webApp: "https://y.test/" },
      [],
      [null],
    ]),
    {
      inline_keyboard: [
        [
          { text: "Run", callback_data: "run:j1" },
          { text: "Open", url: "https://x.test/" },
        ],
        [{ text: "App", web_app: { url: "https://y.test/" } }],
      ],
    },
  );
  assert.equal(keyboard(undefined), undefined);
  assert.equal(keyboard(null), undefined);
  assert.deepEqual(keyboard([]), { inline_keyboard: [] });
  assert.equal(keyboard([[{ text: "Long", data: "x".repeat(100) }]]).inline_keyboard[0][0].callback_data.length, 64);
});

test("httpTransport posts JSON to the Bot API and reads the answer", async () => {
  const send = fakeFetch([[`${API_BASE}/bot${TOKEN}/sendMessage`, () => reply({ ok: true, result: { message_id: 5 } })]]);
  const transport = httpTransport({ fetch: send, token: TOKEN });
  assert.deepEqual(await transport("sendMessage", { chat_id: 1, text: "hi" }), { ok: true, result: { message_id: 5 } });
  assert.equal(send.calls.length, 1);
  assert.equal(send.calls[0].method, "POST");
  assert.equal(send.calls[0].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(send.calls[0].body), { chat_id: 1, text: "hi" });
});

test("httpTransport reports failures without ever showing the token", async () => {
  const send = fakeFetch([
    [`${API_BASE}/bot${TOKEN}/sendMessage`, () => reply({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, { status: 400 })],
    [`${API_BASE}/bot${TOKEN}/editMessageText`, () => reply({ ok: false, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } }, { status: 429 })],
    [`${API_BASE}/bot${TOKEN}/getMe`, () => reply("<html>Bad gateway</html>", { status: 502 })],
    [`${API_BASE}/bot${TOKEN}/leaveChat`, () => reply({ ok: false, description: `Not Found for /bot${TOKEN}/leaveChat` }, { status: 404 })],
    [
      `${API_BASE}/bot${TOKEN}/setWebhook`,
      (url) => {
        throw new Error("fetch failed for " + url);
      },
    ],
  ]);
  const transport = httpTransport({ fetch: send, token: TOKEN });
  assert.deepEqual(await transport("sendMessage", {}), { ok: false, status: 400, description: "Bad Request: can't parse entities", retryAfter: 0 });
  assert.deepEqual(await transport("editMessageText", {}), { ok: false, status: 429, description: "Too Many Requests: retry after 3", retryAfter: 3 });
  assert.deepEqual(await transport("getMe"), { ok: false, status: 502, description: "HTTP 502", retryAfter: 0 });
  const notFound = await transport("leaveChat", {});
  assert.equal(notFound.status, 404);
  assert.ok(!notFound.description.includes(TOKEN) && notFound.description.includes("<token>"));
  const thrown = await transport("setWebhook", {});
  assert.equal(thrown.ok, false);
  assert.equal(thrown.status, 0);
  assert.ok(!thrown.description.includes(TOKEN), thrown.description);
  assert.ok(thrown.description.includes("fetch failed"));
});

test("httpTransport gives up on a call that hangs", async () => {
  const hanging = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const transport = httpTransport({ fetch: hanging, token: TOKEN, timeoutMs: 20 });
  const answer = await transport("sendMessage", {});
  assert.equal(answer.ok, false);
  assert.equal(answer.status, 0);
  assert.ok(!answer.description.includes(TOKEN));
});

function scripted(answers) {
  const calls = [];
  const transport = async (method, payload) => {
    calls.push({ method, payload });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next || { ok: true, result: true };
  };
  transport.calls = calls;
  return transport;
}

test("send posts HTML with buttons and gives the new message id back", async () => {
  const transport = scripted([{ ok: true, result: { message_id: 77 } }]);
  const telegram = createTelegram({ transport });
  const sent = await telegram.send(42, "<b>Hello</b>", { buttons: [[{ text: "Run", data: "run:j1" }]], replyTo: 9, silent: true });
  assert.deepEqual(sent, { ok: true, messageId: 77, status: 0, description: "" });
  assert.deepEqual(transport.calls, [
    {
      method: "sendMessage",
      payload: {
        chat_id: 42,
        text: "<b>Hello</b>",
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: "Run", callback_data: "run:j1" }]] },
        reply_parameters: { message_id: 9, allow_sending_without_reply: true },
        disable_notification: true,
      },
    },
  ]);
});

test("send falls back to plain text when Telegram cannot parse the HTML", async () => {
  const transport = scripted([
    { ok: false, status: 400, description: "Bad Request: can't parse entities: Unsupported start tag", retryAfter: 0 },
    { ok: true, result: { message_id: 78 } },
  ]);
  const telegram = createTelegram({ transport });
  const sent = await telegram.send(42, '<b>Hello</b> <a href="https://x.test/">there</a> &amp; all', { buttons: [[{ text: "Run", data: "run:j1" }]] });
  assert.equal(sent.ok, true);
  assert.equal(sent.messageId, 78);
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[1].payload.text, "Hello there (https://x.test/) & all");
  assert.equal("parse_mode" in transport.calls[1].payload, false);
  assert.deepEqual(transport.calls[1].payload.reply_markup, { inline_keyboard: [[{ text: "Run", callback_data: "run:j1" }]] });
});

test("send does not resend for other failures, and reports them", async () => {
  const transport = scripted([{ ok: false, status: 403, description: "Forbidden: bot was blocked by the user", retryAfter: 0 }]);
  const telegram = createTelegram({ transport });
  assert.deepEqual(await telegram.send(42, "hi"), { ok: false, messageId: null, status: 403, description: "Forbidden: bot was blocked by the user" });
  assert.equal(transport.calls.length, 1);
});

test("edit keeps the buttons, and an unchanged message counts as done", async () => {
  const transport = scripted([
    { ok: true, result: { message_id: 5 } },
    { ok: false, status: 400, description: "Bad Request: message is not modified: specified new message content is the same", retryAfter: 0 },
    { ok: false, status: 400, description: "Bad Request: message to edit not found", retryAfter: 0 },
  ]);
  const telegram = createTelegram({ transport });
  assert.deepEqual(await telegram.edit(42, 5, "<b>Board</b>", { buttons: [[{ text: "Stop", data: "stp:j1" }]] }), { ok: true, description: "" });
  assert.deepEqual(transport.calls[0], {
    method: "editMessageText",
    payload: {
      chat_id: 42,
      message_id: 5,
      text: "<b>Board</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Stop", callback_data: "stp:j1" }]] },
    },
  });
  assert.deepEqual(await telegram.edit(42, 5, "<b>Board</b>"), { ok: true, description: "" });
  assert.deepEqual(await telegram.edit(42, 5, "<b>Board</b>"), { ok: false, description: "Bad Request: message to edit not found" });
});

test("a short 429 is waited out once; a long one is not", async () => {
  const waits = [];
  const sleep = async (ms) => {
    waits.push(ms);
  };
  const quick = scripted([
    { ok: false, status: 429, description: "Too Many Requests: retry after 3", retryAfter: 3 },
    { ok: true, result: { message_id: 1 } },
  ]);
  assert.deepEqual(await createTelegram({ transport: quick, sleep }).call("sendMessage", {}), { ok: true, result: { message_id: 1 } });
  assert.deepEqual(waits, [3250]);
  assert.equal(quick.calls.length, 2);

  const slow = scripted([{ ok: false, status: 429, description: "Too Many Requests: retry after 40", retryAfter: 40 }]);
  const answer = await createTelegram({ transport: slow, sleep }).call("sendMessage", {});
  assert.equal(answer.ok, false);
  assert.equal(answer.retryAfter, 40);
  assert.equal(slow.calls.length, 1);
  assert.deepEqual(waits, [3250]);

  const twice = scripted([
    { ok: false, status: 429, description: "Too Many Requests", retryAfter: 1 },
    { ok: false, status: 429, description: "Too Many Requests", retryAfter: 1 },
  ]);
  assert.equal((await createTelegram({ transport: twice, sleep }).call("sendMessage", {})).ok, false);
  assert.equal(twice.calls.length, 2);
});

test("the client never throws, even when the transport does", async () => {
  const transport = scripted([new Error(`network down for bot${TOKEN}`), undefined]);
  const telegram = createTelegram({ transport });
  const answer = await telegram.call("getMe");
  assert.equal(answer.ok, false);
  assert.ok(!answer.description.includes(TOKEN));
  transport.calls.length = 0;
  const broken = async () => undefined;
  assert.deepEqual(await createTelegram({ transport: broken }).call("getMe"), { ok: false, status: 0, description: "no answer", retryAfter: 0 });
});

test("the small calls send what Telegram expects", async () => {
  const transport = scripted([]);
  const telegram = createTelegram({ transport });
  await telegram.answer("cb1", "x".repeat(300), true);
  await telegram.answer("cb2");
  await telegram.typing(42);
  await telegram.leave(-100);
  await telegram.removeButtons(42, 5);
  assert.deepEqual(transport.calls[0].method, "answerCallbackQuery");
  assert.equal(transport.calls[0].payload.text.length, 190);
  assert.equal(transport.calls[0].payload.show_alert, true);
  assert.deepEqual(transport.calls[1].payload, { callback_query_id: "cb2", text: "", show_alert: false });
  assert.deepEqual(transport.calls[2], { method: "sendChatAction", payload: { chat_id: 42, action: "typing" } });
  assert.deepEqual(transport.calls[3], { method: "leaveChat", payload: { chat_id: -100 } });
  assert.deepEqual(transport.calls[4], {
    method: "editMessageReplyMarkup",
    payload: { chat_id: 42, message_id: 5, reply_markup: { inline_keyboard: [] } },
  });
});

test("the recording transport writes calls down and answers like Telegram", async () => {
  const recorded = [];
  let lastId = 100;
  const transport = recordingTransport({
    record: async (entry) => {
      recorded.push(entry);
    },
    nextMessageId: async () => ++lastId,
  });
  const telegram = createTelegram({ transport });
  const first = await telegram.send(7, "one");
  const second = await telegram.send(7, "two");
  assert.equal(first.messageId, 101);
  assert.equal(second.messageId, 102);
  assert.deepEqual(await telegram.edit(7, 101, "one, edited"), { ok: true, description: "" });
  await telegram.typing(7);
  await telegram.answer("cb", "ok");
  const me = await telegram.call("getMe");
  assert.equal(me.ok, true);
  assert.equal(me.result.is_bot, true);
  assert.deepEqual(
    recorded.map((entry) => entry.method),
    ["sendMessage", "sendMessage", "editMessageText", "answerCallbackQuery", "getMe"],
  );
  assert.equal(recorded[0].payload.text, "one");
  assert.equal(recorded[2].payload.message_id, 101);
});
