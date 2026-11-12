// Telegram for GlowBot: turning a model's Markdown into Telegram HTML, cutting long answers into
// messages that fit, and a small client for the Bot API.
//
// Models write Markdown. Telegram's own Markdown mode rejects a message for one stray "_" or "*", so
// GlowBot converts to HTML itself: every line becomes a short piece of balanced HTML, anything it cannot
// read safely stays plain text, and if Telegram still refuses a message it is sent again as plain text.
//
// The client never throws. A failed call comes back as { ok: false, status, description }, and the bot
// token is removed from every error text, because the token is part of the API address.

import { escapeHtml } from "./strings.js";
import { errorText, sleep as realSleep, withTimeout } from "./util.js";

export { escapeHtml };

export const MESSAGE_LIMIT = 4000; // Telegram allows 4096; the raw HTML is longer than what it counts
export const QUOTE_LIMIT = 3600;
export const API_BASE = "https://api.telegram.org";

const KEPT_OPEN = "\u0001";
const KEPT_CLOSE = "\u0002";

export function scrubToken(text, token) {
  let value = String(text ?? "");
  if (token) value = value.split(token).join("<token>");
  return value.replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, "bot<token>").replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, "<token>");
}

function decodeBasic(text) {
  return String(text ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// Telegram HTML back to plain text: links keep their address, every other tag is dropped.
export function htmlToPlain(html) {
  const withLinks = String(html ?? "").replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (whole, address, label) => {
    const shown = label.replace(/<[^>]+>/g, "");
    return decodeBasic(shown) === decodeBasic(address) ? shown : `${shown} (${address})`;
  });
  return decodeBasic(withLinks.replace(/<\/?[a-zA-Z][^>]*>/g, ""));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function isSafeAddress(address) {
  return /^(https?:\/\/|tg:\/\/)/i.test(address);
}

function isBalanced(html) {
  const open = [];
  const tags = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?>/g;
  let found;
  let last = 0;
  while ((found = tags.exec(html))) {
    if (/[<>]/.test(html.slice(last, found.index))) return false;
    last = tags.lastIndex;
    const name = found[2].toLowerCase();
    if (!found[1]) open.push(name);
    else if (open.pop() !== name) return false;
  }
  return open.length === 0 && !/[<>]/.test(html.slice(last));
}

// One line of Markdown to one line of Telegram HTML. The result always has balanced tags.
export function inlineMd(line) {
  const source = String(line ?? "").replace(/[\u0001\u0002]/g, "");
  const kept = [];
  const keep = (html) => {
    kept.push(html);
    return KEPT_OPEN + (kept.length - 1) + KEPT_CLOSE;
  };

  // Code first: nothing inside a code span is Markdown.
  let text = source.replace(/(`{1,2})(?!`)(.+?)(?<!`)\1(?!`)/g, (whole, ticks, code) => keep(`<code>${escapeHtml(code)}</code>`));

  // Links and images. The address may hold one level of brackets, as Wikipedia addresses do.
  text = text.replace(/!?\[([^\]\n]*)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))+)>?(?:\s+"[^"]*")?\s*\)/g, (whole, label, address) => {
    if (!isSafeAddress(address)) return whole;
    const shown = label.replace(/\*\*|__/g, "").trim() || address;
    return keep(`<a href="${escapeAttribute(address)}">${escapeHtml(shown)}</a>`);
  });

  // Bare addresses are kept as they are, so a "_" or "*" inside one is never read as emphasis.
  text = text.replace(/https?:\/\/[^\s<>\u0001\u0002]+/g, (address) => {
    const trailing = (address.match(/[.,;:!?'")\]}*_]+$/) || [""])[0];
    let core = trailing ? address.slice(0, -trailing.length) : address;
    let rest = trailing;
    const opened = (core.match(/\(/g) || []).length;
    const closed = (core.match(/\)/g) || []).length;
    if (rest.startsWith(")") && opened > closed) {
      core += ")";
      rest = rest.slice(1);
    }
    return keep(escapeHtml(core)) + rest;
  });

  text = escapeHtml(text);
  text = text.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>");
  text = text.replace(/(?<![A-Za-z0-9_])__(?=\S)(.+?)(?<=\S)__(?![A-Za-z0-9_])/g, "<b>$1</b>");
  text = text.replace(/(?<![A-Za-z0-9*])\*(?=[^\s*])([^*<>]*?[^\s*<>])\*(?![A-Za-z0-9*])/g, "<i>$1</i>");
  text = text.replace(/(?<![A-Za-z0-9_])_(?=[^\s_])([^_<>]*?[^\s_<>])_(?![A-Za-z0-9_])/g, "<i>$1</i>");
  text = text.replace(/~~(?=\S)([^~<>]+?)(?<=\S)~~/g, "<s>$1</s>");

  for (let pass = 0; pass < 3 && text.includes(KEPT_OPEN); pass++) {
    text = text.replace(/\u0001(\d+)\u0002/g, (whole, index) => kept[Number(index)] ?? "");
  }
  return isBalanced(text) ? text : escapeHtml(source);
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^:?-{1,}:?$/;

function tableCells(line) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableRule(line) {
  if (!TABLE_ROW.test(line)) return false;
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => TABLE_RULE.test(cell.replace(/\s+/g, "")));
}

function lineToHtml(raw, nextRaw) {
  const heading = raw.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
  if (heading) return `<b>${inlineMd(heading[1].replace(/\*\*|__/g, ""))}</b>`;
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) return "———";
  if (TABLE_ROW.test(raw)) {
    if (isTableRule(raw)) return null;
    const isHeader = typeof nextRaw === "string" && isTableRule(nextRaw);
    const cells = tableCells(raw).filter((cell, index, all) => cell || (index > 0 && index < all.length - 1));
    if (isHeader) return `<b>${cells.map((cell) => inlineMd(cell.replace(/\*\*|__/g, ""))).join(" · ")}</b>`;
    return cells.map((cell) => inlineMd(cell)).join(" · ");
  }
  const bullet = raw.match(/^(\s*)[-*+•]\s+(.*)$/);
  if (bullet) {
    const indent = "  ".repeat(Math.min(3, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2)));
    const box = bullet[2].match(/^\[( |x|X)\]\s+(.*)$/);
    if (box) return `${indent}${box[1] === " " ? "☐" : "☑"} ${inlineMd(box[2])}`;
    return `${indent}• ${inlineMd(bullet[2])}`;
  }
  const numbered = raw.match(/^(\s*)(\d{1,3})[.)]\s+(.*)$/);
  if (numbered) {
    const indent = "  ".repeat(Math.min(3, Math.floor(numbered[1].replace(/\t/g, "  ").length / 2)));
    return `${indent}${numbered[2]}. ${inlineMd(numbered[3])}`;
  }
  return inlineMd(raw.trim());
}

// Markdown to blocks: { type: "text" | "pre" | "quote", lines }. A "text" or "quote" line is balanced
// HTML on its own; a "pre" line is escaped text. That is what lets packBlocks cut between any two lines.
export function mdToBlocks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let current = null;
  const push = (type, line) => {
    if (!current || current.type !== type) {
      current = { type, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  };
  let fence = "";
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].replace(/\s+$/, "");
    if (fence) {
      if (raw.trim().startsWith(fence) && /^(`{3,}|~{3,})$/.test(raw.trim())) {
        fence = "";
        current = null;
      } else {
        push("pre", escapeHtml(raw));
      }
      continue;
    }
    const opening = raw.match(/^\s*(`{3,}|~{3,})/);
    if (opening) {
      fence = opening[1][0].repeat(3);
      current = null;
      continue;
    }
    if (!raw.trim()) {
      if (current && current.type === "text" && current.lines[current.lines.length - 1] !== "") push("text", "");
      else if (current && current.type !== "text") current = null;
      continue;
    }
    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const html = quote[1].trim() ? lineToHtml(quote[1], null) : "";
      if (html !== null) push("quote", html);
      continue;
    }
    const html = lineToHtml(raw, lines[index + 1]);
    if (html !== null) push("text", html);
  }
  for (const block of blocks) {
    while (block.lines.length && block.lines[block.lines.length - 1] === "" && block.type !== "pre") block.lines.pop();
  }
  return blocks.filter((block) => block.lines.length);
}

const WRAPPERS = {
  text: ["", ""],
  pre: ["<pre>", "</pre>"],
  quote: ["<blockquote>", "</blockquote>"],
};

// Cuts plain text into pieces whose escaped form fits the budget: at spaces, or inside a giant word.
function splitPlain(plain, budget) {
  const pieces = [];
  let current = "";
  let size = 0;
  const flush = () => {
    if (current) pieces.push(escapeHtml(current));
    current = "";
    size = 0;
  };
  for (const word of String(plain).split(" ")) {
    const cost = escapeHtml(word).length;
    if (cost > budget) {
      flush();
      for (const character of Array.from(word)) {
        const one = escapeHtml(character).length;
        if (size + one > budget) flush();
        current += character;
        size += one;
      }
      flush();
      continue;
    }
    if (size && size + 1 + cost > budget) flush();
    current += (size ? " " : "") + word;
    size += (size ? 1 : 0) + cost;
  }
  flush();
  return pieces;
}

function renderPieces(pieces) {
  const parts = [];
  pieces.forEach((piece, index) => {
    const lines = piece.lines.slice();
    if (piece.type !== "pre") {
      while (index === 0 && lines.length && lines[0] === "") lines.shift();
      while (index === pieces.length - 1 && lines.length && lines[lines.length - 1] === "") lines.pop();
    }
    if (!lines.length) return;
    const [open, close] = WRAPPERS[piece.type];
    parts.push(open + lines.join("\n") + close);
  });
  return parts.join("\n");
}

// Greedy packing by lines. A block that has to be cut gets its own <pre> or <blockquote> in each message.
export function packBlocks(blocks, limit = MESSAGE_LIMIT) {
  const messages = [];
  let pieces = [];
  let size = 0;
  const flush = () => {
    const text = renderPieces(pieces);
    if (text.trim()) messages.push(text);
    pieces = [];
    size = 0;
  };
  for (const block of blocks || []) {
    const [open, close] = WRAPPERS[block.type] || WRAPPERS.text;
    const overhead = open.length + close.length;
    const budget = Math.max(16, limit - overhead - 1);
    let piece = null;
    for (const original of block.lines) {
      const fitting = original.length <= budget ? [original] : splitPlain(block.type === "pre" ? decodeBasic(original) : htmlToPlain(original), budget);
      for (const line of fitting) {
        const cost = line.length + 1 + (piece ? 0 : overhead);
        if (size > 0 && size + cost > limit) {
          flush();
          piece = null;
        }
        if (!piece) {
          piece = { type: WRAPPERS[block.type] ? block.type : "text", lines: [] };
          pieces.push(piece);
          size += overhead;
        }
        piece.lines.push(line);
        size += line.length + 1;
      }
    }
  }
  flush();
  return messages;
}

export function mdToMessages(markdown, limit = MESSAGE_LIMIT) {
  return packBlocks(mdToBlocks(markdown), limit);
}

// An agent's post: a header line, then the body folded into an expandable quote. Telegram cannot nest
// quotes, so a quoted line inside the body gets a bar in front of it instead.
export function quoteMessages(headerHtml, markdown, limit = QUOTE_LIMIT) {
  const open = "<blockquote expandable>";
  const close = "</blockquote>";
  const blocks = mdToBlocks(markdown).map((block) => (block.type === "quote" ? { type: "text", lines: block.lines.map((line) => `▎ ${line}`) } : block));
  const room = Math.max(400, limit - String(headerHtml).length - open.length - close.length - 12);
  const bodies = packBlocks(blocks, room);
  if (!bodies.length) return [String(headerHtml)];
  return bodies.map((body, index) => `${headerHtml}${bodies.length > 1 ? ` (${index + 1}/${bodies.length})` : ""}\n${open}${body}${close}`);
}

// buttons: rows of { text, data } | { text, url } | { text, webApp }.
export function keyboard(buttons) {
  if (!Array.isArray(buttons)) return undefined;
  const rows = buttons
    .map((row) =>
      (Array.isArray(row) ? row : [row]).filter(Boolean).map((button) => {
        if (button.webApp) return { text: button.text, web_app: { url: button.webApp } };
        if (button.url) return { text: button.text, url: button.url };
        return { text: button.text, callback_data: String(button.data).slice(0, 64) };
      }),
    )
    .filter((row) => row.length);
  return { inline_keyboard: rows };
}

// The real thing: one HTTPS call per method.
export function httpTransport({ fetch, token, base = API_BASE, timeoutMs = 15000 }) {
  return async (method, payload) => {
    try {
      const isForm = typeof FormData !== "undefined" && payload instanceof FormData;
      const response = await withTimeout(
        (signal) =>
          fetch(`${base}/bot${token}/${method}`, {
            method: "POST",
            headers: isForm ? undefined : { "Content-Type": "application/json" },
            body: isForm ? payload : JSON.stringify(payload || {}),
            signal,
          }),
        timeoutMs,
        `Telegram ${method}`,
      );
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
      if (data && data.ok) return { ok: true, result: data.result };
      return {
        ok: false,
        status: response.status,
        description: scrubToken((data && data.description) || `HTTP ${response.status}`, token),
        retryAfter: (data && data.parameters && Number(data.parameters.retry_after)) || 0,
      };
    } catch (error) {
      return { ok: false, status: 0, description: scrubToken(errorText(error), token), retryAfter: 0 };
    }
  };
}

// A stand-in that sends nothing: it writes every call down and answers the way Telegram would.
// The simulator and the self-test use it, so they exercise the same code as a real chat.
export function recordingTransport({ record, nextMessageId }) {
  return async (method, payload) => {
    if (method === "sendChatAction") return { ok: true, result: true };
    const isForm = typeof FormData !== "undefined" && payload instanceof FormData;
    await record({ method, payload: isForm ? { form: true } : payload || {} });
    if (method === "sendMessage") {
      return { ok: true, result: { message_id: await nextMessageId(), chat: { id: payload && payload.chat_id } } };
    }
    if (method === "editMessageText" || method === "editMessageReplyMarkup") {
      return { ok: true, result: { message_id: payload && payload.message_id } };
    }
    if (method === "getMe") {
      return { ok: true, result: { id: 1, is_bot: true, first_name: "GlowBot (simulated)", username: "glow_sim_bot" } };
    }
    return { ok: true, result: true };
  };
}

const PARSE_TROUBLE = /can't parse|cannot parse|unsupported start tag|unclosed|unmatched end tag|entity|entities/i;

export function createTelegram({ transport, sleep = realSleep }) {
  async function call(method, payload) {
    let answer;
    try {
      answer = await transport(method, payload);
    } catch (error) {
      answer = { ok: false, status: 0, description: scrubToken(errorText(error)), retryAfter: 0 };
    }
    if (answer && !answer.ok && answer.status === 429 && answer.retryAfter > 0 && answer.retryAfter <= 5) {
      await sleep(answer.retryAfter * 1000 + 250);
      try {
        answer = await transport(method, payload);
      } catch (error) {
        answer = { ok: false, status: 0, description: scrubToken(errorText(error)), retryAfter: 0 };
      }
    }
    return answer || { ok: false, status: 0, description: "no answer", retryAfter: 0 };
  }

  async function send(chatId, html, options = {}) {
    const payload = {
      chat_id: chatId,
      text: String(html),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    };
    const markup = keyboard(options.buttons);
    if (markup) payload.reply_markup = markup;
    if (options.replyTo) payload.reply_parameters = { message_id: options.replyTo, allow_sending_without_reply: true };
    if (options.silent) payload.disable_notification = true;
    let answer = await call("sendMessage", payload);
    if (!answer.ok && answer.status === 400 && PARSE_TROUBLE.test(answer.description || "")) {
      const plain = { ...payload, text: htmlToPlain(html).slice(0, 4096) };
      delete plain.parse_mode;
      answer = await call("sendMessage", plain);
    }
    return {
      ok: !!answer.ok,
      messageId: answer.ok && answer.result ? answer.result.message_id : null,
      status: answer.status || 0,
      description: answer.ok ? "" : answer.description || "",
    };
  }

  // Telegram drops a message's buttons when its text is edited without them, so pass them every time.
  async function edit(chatId, messageId, html, options = {}) {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: String(html),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    };
    const markup = keyboard(options.buttons);
    if (markup) payload.reply_markup = markup;
    let answer = await call("editMessageText", payload);
    if (!answer.ok && answer.status === 400 && PARSE_TROUBLE.test(answer.description || "")) {
      const plain = { ...payload, text: htmlToPlain(html).slice(0, 4096) };
      delete plain.parse_mode;
      answer = await call("editMessageText", plain);
    }
    const unchanged = !answer.ok && /message is not modified/i.test(answer.description || "");
    return { ok: !!answer.ok || unchanged, description: answer.ok || unchanged ? "" : answer.description || "" };
  }

  async function removeButtons(chatId, messageId) {
    const answer = await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    return { ok: !!answer.ok || /message is not modified/i.test(answer.description || "") };
  }

  return {
    call,
    send,
    edit,
    removeButtons,
    answer: (callbackId, text, alert = false) =>
      call("answerCallbackQuery", { callback_query_id: callbackId, text: String(text || "").slice(0, 190), show_alert: !!alert }),
    typing: (chatId) => call("sendChatAction", { chat_id: chatId, action: "typing" }),
    leave: (chatId) => call("leaveChat", { chat_id: chatId }),
  };
}
