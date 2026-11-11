// Writes tales with the page's own engine and the page's own write loop (worker.js), outside the browser,
// so two sets of weights can be compared on the same starters, settings and seeds.
// usage: node sample_node.js <engine.js> <model dir> <out.json> [--guard]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const [enginePath, modelDir, outPath, guardFlag] = process.argv.slice(2);
const GUARD = guardFlag === "--guard";
const REPEAT_WINDOW = 64;
const REPEAT_PENALTY = 1.5;
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(enginePath, "utf8"), { filename: enginePath });
const Engine = globalThis.GlowSparkEngine;

// Constants copied from worker.js and spark.js; the browser page uses exactly these.
const SENTENCE_END = /[.!?]["']?$/;
const EXTRA_TOKENS_TO_FINISH = 60;
const TOP_K = 40;
const TEMPERATURE = 0.8; // the creativity slider's default (8 of 12) divided by 10
const LENGTHS = { medium: 160, long: 320 };
const STARTERS = [
  "Once upon a time there was a little fox",
  "The old king had three daughters, and",
  "In the middle of the dark forest stood",
  "The moon rose over the sea, and the fisherman",
  "\"Where are you going?\" asked the rabbit.",
  "There was once a poor woodcutter who",
];
const SEEDS = [1, 2, 3];

const meta = JSON.parse(fs.readFileSync(path.join(modelDir, "spark.json"), "utf8"));
const file = fs.readFileSync(path.join(modelDir, meta.weights.file));
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const tokenizer = new Engine.Tokenizer(meta.tokenizer);
const model = new Engine.Model(meta, buffer);
const session = new Engine.Session(tokenizer, model);
const decoder = new TextDecoder("utf-8");
const pieceText = (token) => decoder.decode(tokenizer.bytesOf(token));
// Tokens that are not a whole character on their own (a lone byte of a longer UTF-8 sequence).
const partial = new Set();
for (let token = 0; token < meta.config.vocab; token++) {
  if (token !== tokenizer.eot && pieceText(token).includes("\ufffd")) partial.add(token);
}

// Score minus 1.5 for every time the same three-token phrase was already written in the last 64 tokens.
function guarded(logits, history) {
  const adjusted = Float32Array.from(logits);
  const size = history.length;
  if (size < 2) return adjusted;
  const previous = history[size - 2];
  const last = history[size - 1];
  for (let index = Math.max(0, size - REPEAT_WINDOW); index + 2 < size; index++) {
    if (history[index] === previous && history[index + 1] === last) adjusted[history[index + 2]] -= REPEAT_PENALTY;
  }
  return adjusted;
}

function write(text, maxTokens, seed) {
  const promptTokens = tokenizer.encode("\n" + text);
  session.prime(promptTokens);
  const random = Engine.makeRandom(seed >>> 0);
  const banned = new Set([tokenizer.eot]);
  if (GUARD) for (const token of partial) banned.add(token);
  const options = { temperature: TEMPERATURE, topK: TOP_K, banned: banned };
  let written = 0;
  let out = "";
  let unsure = 0;
  for (;;) {
    const picked = Engine.sample(GUARD ? guarded(session.logits, session.tokens) : session.logits, options, random);
    const piece = pieceText(picked.token);
    const chosen = picked.choices.find((choice) => choice.token === picked.token);
    if (chosen && chosen.p < 0.02) unsure++;
    out += piece;
    session.push(picked.token);
    written++;
    if (written >= maxTokens && (SENTENCE_END.test(piece) || written >= maxTokens + EXTRA_TOKENS_TO_FINISH)) break;
  }
  return { text: (text + out).trim(), tokens: written, unsureTokens: unsure };
}

const started = Date.now();
const samples = [];
for (let starter = 0; starter < STARTERS.length; starter++) {
  for (const [length, maxTokens] of Object.entries(LENGTHS)) {
    for (const seed of SEEDS) {
      const result = write(STARTERS[starter], maxTokens, seed);
      samples.push(Object.assign({ starter: starter, length: length, seed: seed }, result));
      console.log(`starter ${starter} ${length} seed ${seed}: ${result.tokens} tokens`);
    }
  }
}
const seconds = (Date.now() - started) / 1000;
const totalTokens = samples.reduce((sum, sample) => sum + sample.tokens, 0);
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      model_dir: modelDir,
      parameters: meta.parameters,
      config: meta.config,
      weights_sha256: meta.weights.sha256,
      guard: GUARD ? { partial_tokens_banned: partial.size, repeat_window: REPEAT_WINDOW, repeat_penalty: REPEAT_PENALTY } : null,
      temperature: TEMPERATURE,
      top_k: TOP_K,
      seeds: SEEDS,
      starters: STARTERS,
      seconds: seconds,
      tokens_per_second: totalTokens / seconds,
      samples: samples,
    },
    null,
    1
  )
);
console.log(`done: ${samples.length} tales, ${totalTokens} tokens in ${seconds.toFixed(1)} s`);
