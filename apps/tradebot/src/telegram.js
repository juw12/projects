// The few Telegram Bot API calls the bot needs. Messages are Telegram HTML.

import { clip, errorText } from "./util.js";

export const TELEGRAM_API = "https://api.telegram.org";

// buttons = [[{ text, data }, ...], ...] becomes an inline keyboard; [] removes the keyboard.
function keyboard(buttons) {
  if (!buttons) return {};
  const rows = buttons.map((row) => row.map((button) => ({ text: button.text, callback_data: button.data })));
  return { reply_markup: { inline_keyboard: rows } };
}

// createTelegram({ fetch, token, timeoutMs })
export function createTelegram(options = {}) {
  const send = options.fetch || ((input, init) => fetch(input, init));
  const token = String(options.token || "");
  const timeoutMs = options.timeoutMs || 15000;

  // One Bot API call. The token never appears in an error.
  async function call(method, params) {
    if (!token) throw new Error("The bot has no token yet.");
    let data = null;
    let status = 0;
    try {
      const response = await send(`${TELEGRAM_API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params || {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      data = await response.json().catch(() => null);
    } catch (error) {
      throw new Error("Telegram: " + clip(errorText(error).split(token).join("<token>"), 200));
    }
    if (data && data.ok) return data.result;
    throw new Error("Telegram: " + clip((data && data.description) || `HTTP ${status}`, 200));
  }

  function sendMessage(chatId, html, buttons) {
    return call("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...keyboard(buttons),
    });
  }

  // Replace a message's text. "Not modified" is not an error: the message already says this.
  async function editMessage(chatId, messageId, html, buttons) {
    try {
      return await call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...keyboard(buttons || []),
      });
    } catch (error) {
      if (/message is not modified/i.test(errorText(error))) return null;
      throw error;
    }
  }

  return {
    call,
    send: sendMessage,
    edit: editMessage,
    answerCallback: (id, text) => call("answerCallbackQuery", { callback_query_id: id, text: text || undefined }).catch(() => null),
  };
}
