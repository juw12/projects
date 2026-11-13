// Small shared helpers for the TradeBot Worker. No dependencies.

export const VERSION = "0.2.0";

// Cut text to a maximum length, marking the cut with one ellipsis character.
export function clip(text, max) {
  const value = String(text == null ? "" : text);
  return value.length > max ? value.slice(0, Math.max(0, max - 1)) + "…" : value;
}

// A problem the owner can be told as it is: plain words, with what to do next.
export class Problem extends Error {}

export function errorText(error) {
  return String((error && error.message) || error || "unknown error");
}

export function escapeHtml(text) {
  return String(text == null ? "" : text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Compare two strings without stopping at the first different character.
export function safeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function randomHex(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
