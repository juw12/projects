// GlowSpark worker: downloads the weights once, then writes on this device, off the main thread.
// Messages in:  { type: "load" } | { type: "write", id, text | tokens, maxTokens, temperature, topK, seed }
//               | { type: "stop" } | { type: "selftest" }
// Messages out: progress | ready | primed | tokens | done | selftest | error
importScripts("./engine.js");

(function () {
  "use strict";

  const Engine = self.GlowSparkEngine;
  const SENTENCE_END = /[.!?]["']?$/;
  const EXTRA_TOKENS_TO_FINISH = 60;
  const ALTERNATIVES = 4;
  let tokenizer = null;
  let model = null;
  let session = null;
  let currentJob = 0;
  let weightsSha256 = "";

  async function download(url, expectedBytes) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " for " + url);
    }
    if (!response.body || !expectedBytes) {
      return response.arrayBuffer();
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      chunks.push(part.value);
      received += part.value.length;
      self.postMessage({ type: "progress", received: received, total: expectedBytes });
    }
    const joined = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined.buffer;
  }

  async function load() {
    const started = performance.now();
    const metaResponse = await fetch("./spark.json");
    if (!metaResponse.ok) {
      throw new Error("HTTP " + metaResponse.status + " for spark.json");
    }
    const meta = await metaResponse.json();
    const buffer = await download("./" + meta.weights.file, meta.weights.bytes);
    if (buffer.byteLength !== meta.weights.bytes) {
      throw new Error("weights are incomplete");
    }
    const downloaded = performance.now();
    tokenizer = new Engine.Tokenizer(meta.tokenizer);
    model = new Engine.Model(meta, buffer);
    session = new Engine.Session(tokenizer, model);
    weightsSha256 = meta.weights.sha256;
    model.step(tokenizer.eot); // warm up the JIT so the first word is not the slowest
    model.reset();
    self.postMessage({
      type: "ready",
      downloadMs: Math.round(downloaded - started),
      buildMs: Math.round(performance.now() - downloaded),
      config: meta.config,
      parameters: meta.parameters,
    });
  }

  function pieceText(token) {
    return new TextDecoder("utf-8").decode(tokenizer.bytesOf(token));
  }

  function pause() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function sameTokens(left, right) {
    return left.length === right.length && left.every((token, index) => token === right[index]);
  }

  function argmax(values) {
    let best = 0;
    for (let index = 1; index < values.length; index++) {
      if (values[index] > values[best]) {
        best = index;
      }
    }
    return best;
  }

  // Compare this engine with the PyTorch reference stored in parity.json (written by export.py from the
  // same shipped weights): the next-word scores for 5 prompts, and 24 greedy words after each.
  async function selftest() {
    currentJob++; // a running story stops; the next write primes the model again
    const response = await fetch("./parity.json");
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " for parity.json");
    }
    const parity = await response.json();
    const cases = [];
    let worst = 0;
    let pass = parity.weights_sha256 === weightsSha256;
    for (const item of parity.cases) {
      const tokensMatch = sameTokens(tokenizer.encode("\n" + item.prompt), item.tokens);
      model.reset();
      let logits = null;
      for (const token of item.tokens) {
        logits = model.step(token);
      }
      const packed = atob(item.logits_f32_base64);
      const bytes = new Uint8Array(packed.length);
      for (let index = 0; index < packed.length; index++) {
        bytes[index] = packed.charCodeAt(index);
      }
      const reference = new Float32Array(bytes.buffer);
      let maxAbsDiff = reference.length === logits.length ? 0 : Infinity;
      for (let index = 0; index < reference.length; index++) {
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(reference[index] - logits[index]));
      }
      const greedy = [];
      for (let count = 0; count < item.greedy.length; count++) {
        const following = argmax(logits);
        greedy.push(following);
        logits = model.step(following);
      }
      const greedyMatch = sameTokens(greedy, item.greedy);
      worst = Math.max(worst, maxAbsDiff);
      pass = pass && tokensMatch && greedyMatch && maxAbsDiff < parity.tolerance;
      cases.push({ prompt: item.prompt, tokensMatch: tokensMatch, greedyMatch: greedyMatch, maxAbsDiff: maxAbsDiff });
      await pause();
    }
    model.reset();
    self.postMessage({
      type: "selftest",
      pass: pass,
      weightsMatch: parity.weights_sha256 === weightsSha256,
      maxAbsDiff: worst,
      tolerance: parity.tolerance,
      cases: cases,
    });
  }

  async function write(request) {
    const job = ++currentJob;
    const started = performance.now();
    const promptTokens = request.tokens ? request.tokens.slice() : tokenizer.encode("\n" + (request.text || ""));
    self.postMessage({
      type: "primed",
      id: request.id,
      items: promptTokens.map((token) => ({ token: token, text: pieceText(token) })),
    });
    session.prime(promptTokens);
    const random = Engine.makeRandom(request.seed >>> 0);
    const options = {
      temperature: request.temperature,
      topK: request.topK,
      banned: new Set([tokenizer.eot]),
    };
    const maxTokens = request.maxTokens;
    const primedAt = performance.now();
    let batch = [];
    let written = 0;
    let lastFlush = primedAt;
    let reason = "length";
    const flush = () => {
      if (batch.length) {
        self.postMessage({
          type: "tokens",
          id: request.id,
          items: batch,
          written: written,
          tokensPerSecond: written / Math.max(0.001, (performance.now() - primedAt) / 1000),
        });
        batch = [];
      }
    };
    for (;;) {
      const picked = Engine.sample(session.logits, options, random);
      const text = pieceText(picked.token);
      const alternatives = [];
      for (const choice of picked.choices) {
        if (alternatives.length >= ALTERNATIVES) {
          break;
        }
        const choiceText = pieceText(choice.token);
        if (choice.token !== picked.token && choiceText.indexOf("\ufffd") < 0) {
          alternatives.push({ token: choice.token, text: choiceText, p: choice.p });
        }
      }
      const chosen = picked.choices.find((choice) => choice.token === picked.token);
      batch.push({ token: picked.token, text: text, p: chosen ? chosen.p : 0, alternatives: alternatives });
      session.push(picked.token);
      written++;
      if (written >= maxTokens && (SENTENCE_END.test(text) || written >= maxTokens + EXTRA_TOKENS_TO_FINISH)) {
        break;
      }
      const now = performance.now();
      if (now - lastFlush > 40) {
        flush();
        await pause();
        lastFlush = performance.now();
        if (job !== currentJob) {
          reason = "stopped";
          break;
        }
      }
    }
    flush();
    self.postMessage({
      type: "done",
      id: request.id,
      reason: reason,
      written: written,
      primeMs: Math.round(primedAt - started),
      tokensPerSecond: written / Math.max(0.001, (performance.now() - primedAt) / 1000),
    });
  }

  self.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "load") {
      load().catch((error) => self.postMessage({ type: "error", stage: "load", message: String(error && error.message || error) }));
    } else if (message.type === "write") {
      if (!session) {
        self.postMessage({ type: "error", stage: "write", message: "model is not loaded" });
        return;
      }
      write(message).catch((error) => self.postMessage({ type: "error", stage: "write", id: message.id, message: String(error && error.message || error) }));
    } else if (message.type === "stop") {
      currentJob++;
    } else if (message.type === "selftest") {
      if (!session) {
        self.postMessage({ type: "error", stage: "selftest", message: "model is not loaded" });
        return;
      }
      selftest().catch((error) => self.postMessage({ type: "error", stage: "selftest", message: String(error && error.message || error) }));
    }
  };
})();
