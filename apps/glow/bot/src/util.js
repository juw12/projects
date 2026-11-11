// Small shared helpers for the GlowBot Worker. No dependencies.

export const VERSION = "0.1.0-probe";

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class StoppedError extends Error {
  constructor(message) {
    super(message || "stopped");
    this.name = "StoppedError";
  }
}

// Cut text to a maximum length, marking the cut with one ellipsis character.
export function clip(text, max) {
  const value = String(text == null ? "" : text);
  return value.length > max ? value.slice(0, Math.max(0, max - 1)) + "…" : value;
}

export function errorText(error) {
  return String((error && error.message) || error || "unknown error");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Run work(signal) with a time limit. The inner signal aborts on the timeout or when the outer
// signal aborts, so a fetch that is still waiting gets cancelled instead of left hanging.
export async function withTimeout(work, ms, label, outerSignal) {
  const controller = new AbortController();
  let timer = null;
  let onOuterAbort = null;
  const stopped = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`${label || "request"} timed out after ${Math.round(ms / 1000)} s`));
    }, ms);
    if (outerSignal) {
      onOuterAbort = () => {
        controller.abort();
        reject(new StoppedError());
      };
      if (outerSignal.aborted) onOuterAbort();
      else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), stopped]);
  } finally {
    clearTimeout(timer);
    if (outerSignal && onOuterAbort) outerSignal.removeEventListener("abort", onOuterAbort);
  }
}

// Run tasks (functions returning promises) a few at a time. A Worker may only have six
// connections waiting for an answer at once, so nothing here opens more than `limit`.
export async function inBatches(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  }
  const workers = [];
  for (let count = 0; count < Math.min(limit, tasks.length); count++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// CORS headers for the Glow page. An origin that is not on the list gets none.
export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = { Vary: "Origin" };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Glow-Setup-Code";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
