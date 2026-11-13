// Telegram's Bot API, and turning the models' Markdown into the small HTML subset Telegram shows.
//
// Telegram allows 4096 visible characters per message, so long answers are cut at line breaks
// (never inside a code block) and sent as several messages. When Telegram cannot read our HTML,
// the same piece is sent again as plain text, so an answer is never lost to a formatting slip.

import { clip, errorText, sleep, withTimeout } from "./util.js";

export const TELEGRAM_API = "https://api.telegram.org";
export const MESSAGE_CHUNK = 3500; // visible characters per message, well under Telegram's 4096

export class TelegramError extends Error {
  constructor(description, code, retryAfter) {
    super(description || "Telegram refused the request");
    this.name = "TelegramError";
    this.code = code || 0;
    this.retryAfter = retryAfter || 0;
  }
}

export function escapeHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function escapeAttribute(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

// Inline Markdown: code spans, links, bold, italic and strikethrough.
function inline(text) {
  const codes = [];
  const links = [];
  let value = String(text).replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  value = value.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    links.push([label, url]);
    return `\u0001${links.length - 1}\u0001`;
  });
  value = escapeHtml(value);
  value = value.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+)__/g, "<b>$1</b>");
  value = value.replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?![\w*])/g, "$1<i>$2</i>");
  value = value.replace(/(^|[^\w_])_([^_\s][^_\n]*?)_(?![\w_])/g, "$1<i>$2</i>");
  value = value.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  value = value.replace(/\u0001(\d+)\u0001/g, (_, index) => {
    const [label, url] = links[Number(index)];
    return `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
  });
  return value.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`);
}

const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

// One line of Markdown outside a code block. Returns null for a line that should disappear.
function blockLine(line) {
  let match;
  if ((match = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/))) return `<b>${inline(match[1])}</b>`;
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return "──────────";
  if ((match = line.match(/^(\s*)[-*+]\s+(.*)$/))) return `${match[1]}• ${inline(match[2])}`;
  if ((match = line.match(/^\s*>\s?(.*)$/))) return `<blockquote>${inline(match[1])}</blockquote>`;
  if (TABLE_RULE.test(line) && line.includes("-")) return null;
  if (/^\s*\|.*\|\s*$/.test(line)) {
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    return inline(cells.join(" · "));
  }
  return inline(line);
}

// Markdown (as the models write it) to Telegram HTML.
export function markdownToHtml(markdown) {
  const lines = String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let code = null;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (code) {
        out.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
        code = null;
      } else {
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const converted = blockLine(line);
    if (converted !== null) out.push(converted);
  }
  if (code) out.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Cut Markdown into pieces of at most `max` characters at line breaks. A code block that has to
// be cut is closed at the end of one piece and opened again at the start of the next.
export function splitMarkdown(markdown, max = MESSAGE_CHUNK) {
  const text = String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const lines = [];
  for (const line of text.split("\n")) {
    if (line.length <= max) {
      lines.push(line);
      continue;
    }
    for (let start = 0; start < line.length; start += max - 10) lines.push(line.slice(start, start + max - 10));
  }
  const pieces = [];
  let current = [];
  let size = 0;
  let inCode = false;
  for (const line of lines) {
    const fence = /^\s*```/.test(line);
    if (size + line.length + 1 > max - 8 && current.length) {
      if (inCode) current.push("```");
      pieces.push(current.join("\n").trim());
      current = inCode ? ["```"] : [];
      size = inCode ? 4 : 0;
    }
    current.push(line);
    size += line.length + 1;
    if (fence) inCode = !inCode;
  }
  if (current.length) pieces.push(current.join("\n").trim());
  return pieces.filter((piece) => piece && piece !== "```");
}

// createTelegram({ fetch, token, timeoutMs })
export function createTelegram(options) {
  const settings = options || {};
  const send = settings.fetch || ((input, init) => fetch(input, init));
  const token = String(settings.token || "");
  const timeoutMs = settings.timeoutMs || 20000;
  const wait = settings.sleep || sleep;

  // One Bot API call. A short "retry after" is waited out once; the token never appears in an error.
  async function call(method, params) {
    if (!token) throw new TelegramError("The bot has no token yet");
    for (let attempt = 0; ; attempt++) {
      let data = null;
      let status = 0;
      try {
        const response = await withTimeout(
          (signal) =>
            send(`${TELEGRAM_API}/bot${token}/${method}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(params || {}),
              signal,
            }),
          timeoutMs,
          "Telegram",
        );
        status = response.status;
        data = await response.json().catch(() => null);
      } catch (error) {
        throw new TelegramError(clip(errorText(error).split(token).join("<token>"), 200));
      }
      if (data && data.ok) return data.result;
      const retryAfter = Number((data && data.parameters && data.parameters.retry_after) || 0);
      if (retryAfter > 0 && retryAfter <= 5 && attempt === 0) {
        await wait(retryAfter * 1000);
        continue;
      }
      throw new TelegramError(
        clip((data && data.description) || `HTTP ${status}`, 200),
        (data && data.error_code) || status,
        retryAfter,
      );
    }
  }

  const unreadable = (error) => error instanceof TelegramError && /can't parse entities|unsupported start tag|can't find end/i.test(error.message);

  // Send HTML; when Telegram cannot read it, send the fallback text without formatting.
  async function sendHtml(chatId, html, fallback, extra) {
    const base = { chat_id: chatId, link_preview_options: { is_disabled: true }, ...(extra || {}) };
    try {
      return await call("sendMessage", { ...base, text: html, parse_mode: "HTML" });
    } catch (error) {
      if (!unreadable(error)) throw error;
      return call("sendMessage", { ...base, text: clip(fallback, 4096) });
    }
  }

  // Send Markdown as one or more messages. Buttons (extra.reply_markup) go on the last one.
  async function sendMarkdown(chatId, markdown, extra) {
    const pieces = splitMarkdown(markdown);
    if (!pieces.length) pieces.push("…");
    let last = null;
    for (let index = 0; index < pieces.length; index++) {
      const isLast = index === pieces.length - 1;
      last = await sendHtml(chatId, markdownToHtml(pieces[index]), pieces[index], isLast ? extra : undefined);
    }
    return last;
  }

  // Replace a message's text. "Not modified" is not an error: the message already says this.
  async function editHtml(chatId, messageId, html, extra) {
    try {
      return await call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(extra || {}),
      });
    } catch (error) {
      if (error instanceof TelegramError && /message is not modified/i.test(error.message)) return null;
      throw error;
    }
  }

  return {
    call,
    sendHtml,
    sendMarkdown,
    editHtml,
    typing: (chatId) => call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => null),
    answerCallback: (id, text) => call("answerCallbackQuery", { callback_query_id: id, text: text || undefined }).catch(() => null),
  };
}
