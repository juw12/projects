// The checks every message of the bot has to pass. tools/transcript.js plays one long conversation
// against the real Worker (pairing, trades, mistakes, an outage, several days); these tests read
// every message it produced.

import assert from "node:assert/strict";
import { test } from "node:test";

import { play } from "../tools/transcript.js";

const first = await play();
const sent = first.messages.filter((message) => message.kind !== "popup");
const all = first.messages;

test("the conversation is the same every time and covers every situation", async () => {
  const second = await play();
  assert.equal(second.markdown, first.markdown);
  assert.ok(first.seen.exits.length >= 3, `exits by stop, by rule and by hand: ${first.seen.exits}`);
  assert.ok(first.seen.pending >= 2, "two offers waited for an answer");
  assert.ok(first.seen.blind, "the price sources were down long enough for the warning");
  assert.ok(first.seen.days.length >= 3, "three days passed");
  assert.equal(first.state.portfolio.start, 5000, "the account was reset to $5,000");
  assert.deepEqual(first.state.trades, []);
});

test("every command and every tap gets an answer", () => {
  assert.deepEqual(first.seen.unanswered, []);
});

test("every message is Telegram HTML that Telegram accepts, and fits", () => {
  for (const { html, buttons, kind } of all) {
    if (kind === "popup") {
      assert.ok(html.length <= 200, `pop-up too long: ${html}`);
      continue;
    }
    const tags = html.match(/<[^>]*>/g) || [];
    const open = [];
    for (const tag of tags) {
      const match = tag.match(/^<(\/?)(b|i|code)>$/);
      assert.ok(match, `tag Telegram does not know: ${tag} in ${html}`);
      if (!match[1]) open.push(match[2]);
      else assert.equal(open.pop(), match[2], `tags closed in the wrong order in ${html}`);
    }
    assert.deepEqual(open, [], `tag left open in ${html}`);
    assert.ok(!/&(?!amp;|lt;|gt;)/.test(html), `a bare & in ${html}`);
    assert.ok(html.replace(/<[^>]+>/g, "").length <= 4096, "longer than one Telegram message");
    assert.ok(html.trim().length > 0, "an empty message");
    for (const button of (buttons || []).flat()) {
      assert.ok(Buffer.byteLength(button.callback_data, "utf8") <= 64, `button data too long: ${button.callback_data}`);
    }
  }
});

test("no message shows an exchange's raw answer or the program's insides", () => {
  const raw = [
    /HTTP \d{3}/,
    /\b(Gate|Kraken|MEXC|OKX|Binance):/,
    /INVALID_|EQuery|Instrument ID|Invalid symbol|Invalid currency pair|unexpected answer/,
    /\b[A-Z0-9]{2,12}USDT\b/,
    /\b(undefined|NaN|Infinity|null)\b|\[object/,
    /Error:|TypeError|at \w+ \(/,
    /…/, // text cut off in the middle
  ];
  for (const { html } of all) {
    for (const pattern of raw) assert.ok(!pattern.test(html), `${pattern} in: ${html}`);
  }
});

test("every trade, offer, account view, summary and reset says it is practice money", () => {
  const aboutMoney = sent.filter(({ html, kind }) => kind === "message" && /^(🟢|🟡|🔴|✅ <b>Sold|💼|🗓|🆕)/u.test(html));
  assert.ok(aboutMoney.length >= 15, `only ${aboutMoney.length} money messages found`);
  for (const { html } of aboutMoney) assert.match(html, /practice/i, `does not say practice money: ${html}`);
});

test("no secret appears in any message or in the transcript", () => {
  assert.ok(first.seen.secrets.length >= 4);
  for (const secret of first.seen.secrets) {
    assert.ok(!first.markdown.includes(secret), "a secret is in the transcript");
    for (const { html } of all) assert.ok(!html.includes(secret), "a secret is in a message");
  }
});
