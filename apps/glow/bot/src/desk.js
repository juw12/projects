// GlowBot's desk: the owner's own notes, saved links and approved posts, with a Guard that keeps
// private words and secrets out of them.
//
// It lives in the storage of the owner's own chat, one stored value per item, so nothing here grows
// the chat's single "chat" value. Nothing in this file talks to Telegram or to an AI model.
//
// The private words are the owner's: they are kept in that chat's storage and nowhere in this code.

const META_KEY = "desk:meta";
const PREFIXES = { note: "desk:n:", link: "desk:l:", post: "desk:p:" };

export const DESK_CAP = 500; // items kept of one kind; the oldest goes when one more is written
export const NOTE_CLIP = 1000;
export const POST_CLIP = 3500;
export const URL_CLIP = 500;
export const TITLE_CLIP = 150;
export const GUARD_WORDS = 200;
const WORD_MIN = 2;
const WORD_MAX = 40;

// What a secret looks like, whoever it belongs to. These are shapes, not anybody's real keys.
const SECRET_SHAPES = [
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, // a Telegram bot token
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // a GitHub token
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/, // an API key of the "sk-" kind
  /\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*\S{4,}/i,
];

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "Blue Fern, quartzite" -> ["blue fern", "quartzite"]: lower case, no doubles, 2 to 40 characters.
export function parseWords(text) {
  const words = [];
  for (const part of String(text == null ? "" : text).split(/[,;\n]+/)) {
    const word = part.trim().toLowerCase().replace(/\s+/g, " ");
    if (word.length < WORD_MIN || word.length > WORD_MAX) continue;
    if (!words.includes(word)) words.push(word);
  }
  return words;
}

// How many of the words are in the text, as whole words: "fern" is not found in "ferns".
export function wordHits(text, words) {
  const low = String(text == null ? "" : text).toLowerCase();
  let hits = 0;
  for (const word of Array.isArray(words) ? words : []) {
    if (!word) continue;
    if (new RegExp(`(?<![a-z0-9])${escapeRegExp(word)}(?![a-z0-9])`).test(low)) hits += 1;
  }
  return hits;
}

export function hasSecret(text) {
  const value = String(text == null ? "" : text);
  return SECRET_SHAPES.some((shape) => shape.test(value));
}

// scanText(text, words) -> { words, secret, clean }. It counts; it never says which word it found.
export function scanText(text, words) {
  const found = wordHits(text, words);
  const secret = hasSecret(text);
  return { words: found, secret, clean: found === 0 && !secret };
}

// "2026-11-12 02:30" on the clock that is offsetMs ahead of UTC.
export function stamp(at, offsetMs = 0) {
  return new Date(Number(at) + offsetMs).toISOString().slice(0, 16).replace("T", " ");
}

// The whole desk as one Markdown file. An item the Guard would block is written as `hidden`.
export function exportMarkdown({ notes = [], links = [], posts = [], guard = [], now = 0, offsetMs = 0, hidden = "(hidden)" }) {
  const shown = (text) => (scanText(text, guard).clean ? String(text) : hidden);
  const lines = ["# Glow desk", "", `Exported ${stamp(now, offsetMs)}`, ""];
  lines.push(`## Notes (${notes.length})`, "");
  for (const note of notes) {
    const tag = note.kind === "log" ? " [log]" : "";
    lines.push(`- ${stamp(note.at, offsetMs)}${tag} ${shown(note.text).replace(/\s*\n\s*/g, " ")}`);
  }
  lines.push("", `## Links (${links.length})`, "");
  for (const link of links) {
    const clean = scanText(`${link.title} ${link.url}`, guard).clean;
    lines.push(clean ? `- ${stamp(link.at, offsetMs)} ${link.title || link.url}: ${link.url}` : `- ${stamp(link.at, offsetMs)} ${hidden}`);
  }
  lines.push("", `## Posts (${posts.length})`, "");
  for (const post of posts) {
    lines.push(`### ${stamp(post.at, offsetMs)}`, "", shown(post.text), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function itemKey(kind, n) {
  return PREFIXES[kind] + String(n).padStart(8, "0");
}

function freshMeta() {
  return { seq: { note: 0, link: 0, post: 0 }, guard: [], pending: null, proposals: 0 };
}

// createDesk({ storage, now }) -> the desk of the chat that owns this storage.
export function createDesk({ storage, now = () => Date.now() }) {
  async function meta() {
    const saved = await storage.get(META_KEY);
    const base = freshMeta();
    if (!saved || typeof saved !== "object") return base;
    return {
      seq: { ...base.seq, ...(saved.seq || {}) },
      guard: Array.isArray(saved.guard) ? saved.guard : [],
      pending: saved.pending && typeof saved.pending === "object" ? saved.pending : null,
      proposals: Number(saved.proposals) || 0,
    };
  }

  // Writes one item and the counters together, and lets go of the item that falls off the end.
  async function add(kind, item, state) {
    const current = state || (await meta());
    current.seq[kind] += 1;
    const n = current.seq[kind];
    const stored = { n, at: now(), ...item };
    await storage.put({ [itemKey(kind, n)]: stored, [META_KEY]: current });
    if (n > DESK_CAP) await storage.delete(itemKey(kind, n - DESK_CAP));
    return stored;
  }

  // Oldest first. limit keeps only the newest so many.
  async function list(kind, limit = 0) {
    const found = await storage.list({ prefix: PREFIXES[kind] });
    const items = [...found.values()].filter((item) => item && typeof item === "object").sort((a, b) => a.n - b.n);
    return limit > 0 ? items.slice(-limit) : items;
  }

  return {
    notes: (limit) => list("note", limit),
    links: (limit) => list("link", limit),
    posts: (limit) => list("post", limit),

    addNote(text, kind = "note") {
      return add("note", { kind: kind === "log" ? "log" : "note", text: String(text).slice(0, NOTE_CLIP) });
    },

    // -> { saved, link }: saved is false when this address is on the desk already.
    async addLink(url, title = "") {
      const address = String(url).slice(0, URL_CLIP);
      const known = (await list("link")).find((link) => link.url === address);
      if (known) return { saved: false, link: known };
      const link = await add("link", { url: address, title: String(title || "").slice(0, TITLE_CLIP) });
      return { saved: true, link };
    },

    async guard() {
      return (await meta()).guard;
    },

    // -> { added, total }
    async addGuard(text) {
      const current = await meta();
      const before = current.guard.length;
      for (const word of parseWords(text)) {
        if (current.guard.length >= GUARD_WORDS) break;
        if (!current.guard.includes(word)) current.guard.push(word);
      }
      await storage.put(META_KEY, current);
      return { added: current.guard.length - before, total: current.guard.length };
    },

    async clearGuard() {
      const current = await meta();
      current.guard = [];
      await storage.put(META_KEY, current);
    },

    // A post waits here until it is approved or rejected. A newer one takes the older one's place.
    async propose(text) {
      const current = await meta();
      current.proposals += 1;
      current.pending = { id: String(current.proposals), text: String(text).slice(0, POST_CLIP) };
      await storage.put(META_KEY, current);
      return current.pending;
    },

    // -> null when no post with this id is waiting; otherwise { approved, post }.
    async decide(id, approve) {
      const current = await meta();
      const pending = current.pending;
      if (!pending || pending.id !== String(id)) return null;
      current.pending = null;
      if (!approve) {
        await storage.put(META_KEY, current);
        return { approved: false, post: null };
      }
      const post = await add("post", { text: pending.text }, current);
      return { approved: true, post };
    },

    async all() {
      const [notes, links, posts, current] = await Promise.all([list("note"), list("link"), list("post"), meta()]);
      return { notes, links, posts, guard: current.guard };
    },
  };
}
