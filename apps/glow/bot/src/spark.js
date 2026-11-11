// GlowSpark inside the bot: the same from-scratch model the GlowSpark page runs in the browser.
// The engine file is the page's own (apps/glow/web/spark/engine.js); the weights come from the Glow site.
// The writing loop below mirrors the page's worker (apps/glow/web/spark/worker.js) so a tale reads the same.

import * as sparkModule from "../../web/spark/engine.js";
import { withTimeout } from "./util.js";

const SENTENCE_END = /[.!?]["']?$/;
const EXTRA_TOKENS_TO_FINISH = 60;
const LONGEST_TALE = 600;
const DOWNLOAD_TIMEOUT_MS = 30000;

// The engine is a plain browser script. In a Worker it puts itself on the global object; in Node it
// arrives as the file's exports. Looked up when first needed, not when this file loads.
function engine() {
  const found =
    globalThis.GlowSparkEngine ||
    (sparkModule.default && sparkModule.default.GlowSparkEngine) ||
    sparkModule.GlowSparkEngine;
  if (!found) throw new Error("the GlowSpark engine did not load");
  return found;
}

async function sha256OfBytes(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// createSpark({ fetch, base, now }) -> { load, loaded, write, info }
export function createSpark(options) {
  const settings = options || {};
  const send = settings.fetch || ((input, init) => fetch(input, init));
  const now = settings.now || (() => Date.now());
  const base = String(settings.base || "https://juw12.github.io/projects/glow/spark").replace(/\/+$/, "");
  let ready = null;
  let loading = null;

  async function download(signal) {
    const metaResponse = await send(base + "/spark.json", { signal });
    if (!metaResponse.ok) throw new Error(`HTTP ${metaResponse.status} for spark.json`);
    const meta = await metaResponse.json();
    const weightsResponse = await send(base + "/" + meta.weights.file, { signal });
    if (!weightsResponse.ok) throw new Error(`HTTP ${weightsResponse.status} for ${meta.weights.file}`);
    const buffer = await weightsResponse.arrayBuffer();
    if (buffer.byteLength !== meta.weights.bytes) throw new Error("weights are incomplete");
    if (meta.weights.sha256 && (await sha256OfBytes(buffer)) !== meta.weights.sha256) {
      throw new Error("weights do not match their checksum");
    }
    return { meta, buffer };
  }

  function info() {
    return {
      loaded: !!ready,
      parameters: ready ? ready.meta.parameters : 0,
      context: ready ? ready.model.context : 0,
      downloadMs: ready ? ready.downloadMs : 0,
      buildMs: ready ? ready.buildMs : 0,
    };
  }

  // Download the model once and keep it in memory while this instance lives.
  async function load(signal) {
    if (ready) return info();
    if (!loading) {
      loading = (async () => {
        const started = now();
        const { meta, buffer } = await withTimeout((inner) => download(inner), DOWNLOAD_TIMEOUT_MS, "GlowSpark download", signal);
        const downloaded = now();
        const Engine = engine();
        const tokenizer = new Engine.Tokenizer(meta.tokenizer);
        const model = new Engine.Model(meta, buffer);
        const session = new Engine.Session(tokenizer, model);
        model.step(tokenizer.eot); // warm up, as the page does
        model.reset();
        ready = { Engine, tokenizer, model, session, meta, downloadMs: downloaded - started, buildMs: now() - downloaded };
      })();
      loading.then(
        () => {
          loading = null;
        },
        () => {
          loading = null;
        },
      );
    }
    await loading;
    return info();
  }

  // write(opening, { maxTokens, temperature, topK, seed }) -> { text, tokens, ms, seed }
  // `text` is what the model added after the opening. The same seed and opening give the same tale.
  function write(opening, writeOptions) {
    if (!ready) throw new Error("GlowSpark is not loaded yet");
    const { Engine, tokenizer, session } = ready;
    const wanted = writeOptions || {};
    const maxTokens = Math.max(1, Math.min(LONGEST_TALE, Math.floor(wanted.maxTokens || 160)));
    const seed = (wanted.seed === undefined || wanted.seed === null ? Math.floor(Math.random() * 4294967296) : wanted.seed) >>> 0;
    const started = now();
    session.prime(tokenizer.encode("\n" + String(opening == null ? "" : opening)));
    const random = Engine.makeRandom(seed);
    const sampling = {
      temperature: wanted.temperature === undefined ? 0.8 : wanted.temperature,
      topK: wanted.topK || 40,
      banned: new Set([tokenizer.eot]),
    };
    const pieceDecoder = new TextDecoder("utf-8");
    const written = [];
    for (;;) {
      const picked = Engine.sample(session.logits, sampling, random);
      written.push(picked.token);
      session.push(picked.token);
      const piece = pieceDecoder.decode(tokenizer.bytesOf(picked.token));
      if (written.length >= maxTokens && (SENTENCE_END.test(piece) || written.length >= maxTokens + EXTRA_TOKENS_TO_FINISH)) {
        break;
      }
    }
    // Decoded once at the end: a character can be split over two tokens.
    return { text: tokenizer.decode(written), tokens: written.length, ms: now() - started, seed };
  }

  return { load, loaded: () => !!ready, write, info };
}
