// GlowSpark engine: a byte-level BPE tokenizer and a decoder-only transformer, written from scratch in
// plain JavaScript. No library, no WebGPU, no WebAssembly. It mirrors apps/glow/spark/model.py and
// tokenizer.py exactly; tests/test_glow_spark.py checks the logits against the PyTorch reference.
(function (root) {
  "use strict";

  const PATTERN = / ?[A-Za-z']+| ?[0-9]+|[ \t\n\r]+| ?[^ \t\n\rA-Za-z0-9']+/gu;
  const EOT_TEXT = "<|endoftext|>";
  const GELU_SCALE = Math.sqrt(2 / Math.PI);

  // ---- tokenizer -------------------------------------------------------------------------------
  class Tokenizer {
    constructor(spec) {
      this.vocabSize = spec.vocab_size;
      this.eot = spec.vocab_size - 1;
      this.rank = new Map();
      this.tokenBytes = [];
      for (let value = 0; value < 256; value++) {
        this.tokenBytes.push(Uint8Array.of(value));
      }
      const merges = spec.merges;
      for (let index = 0; index * 2 < merges.length; index++) {
        const left = merges[2 * index];
        const right = merges[2 * index + 1];
        this.rank.set(left * 65536 + right, index);
        const joined = new Uint8Array(this.tokenBytes[left].length + this.tokenBytes[right].length);
        joined.set(this.tokenBytes[left], 0);
        joined.set(this.tokenBytes[right], this.tokenBytes[left].length);
        this.tokenBytes.push(joined);
      }
      this.cache = new Map();
      this.encoder = new TextEncoder();
    }

    encodeChunk(chunk) {
      const cached = this.cache.get(chunk);
      if (cached) {
        return cached;
      }
      let symbols = Array.from(this.encoder.encode(chunk));
      while (symbols.length > 1) {
        let bestRank = -1;
        for (let index = 0; index + 1 < symbols.length; index++) {
          const rank = this.rank.get(symbols[index] * 65536 + symbols[index + 1]);
          if (rank !== undefined && (bestRank < 0 || rank < bestRank)) {
            bestRank = rank;
          }
        }
        if (bestRank < 0) {
          break;
        }
        const merged = [];
        let position = 0;
        while (position < symbols.length) {
          const pairRank =
            position + 1 < symbols.length
              ? this.rank.get(symbols[position] * 65536 + symbols[position + 1])
              : undefined;
          if (pairRank === bestRank) {
            merged.push(256 + bestRank);
            position += 2;
          } else {
            merged.push(symbols[position]);
            position += 1;
          }
        }
        symbols = merged;
      }
      if (this.cache.size < 20000) {
        this.cache.set(chunk, symbols);
      }
      return symbols;
    }

    encode(text) {
      const ids = [];
      const parts = String(text).split(EOT_TEXT);
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        if (partIndex) {
          ids.push(this.eot);
        }
        const chunks = parts[partIndex].match(PATTERN) || [];
        for (const chunk of chunks) {
          const symbols = this.encodeChunk(chunk);
          for (const symbol of symbols) {
            ids.push(symbol);
          }
        }
      }
      return ids;
    }

    bytesOf(token) {
      return token === this.eot ? new Uint8Array(0) : this.tokenBytes[token];
    }

    decode(ids) {
      let total = 0;
      for (const token of ids) {
        total += this.bytesOf(token).length;
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const token of ids) {
        bytes.set(this.bytesOf(token), offset);
        offset += this.bytesOf(token).length;
      }
      return new TextDecoder("utf-8").decode(bytes);
    }
  }

  // ---- maths -----------------------------------------------------------------------------------
  function matVec(weights, rows, cols, input, output) {
    let base = 0;
    const tail = cols - (cols % 4);
    for (let row = 0; row < rows; row++) {
      let sum0 = 0;
      let sum1 = 0;
      let sum2 = 0;
      let sum3 = 0;
      let col = 0;
      for (; col < tail; col += 4) {
        sum0 += weights[base + col] * input[col];
        sum1 += weights[base + col + 1] * input[col + 1];
        sum2 += weights[base + col + 2] * input[col + 2];
        sum3 += weights[base + col + 3] * input[col + 3];
      }
      for (; col < cols; col++) {
        sum0 += weights[base + col] * input[col];
      }
      output[row] = sum0 + sum1 + sum2 + sum3;
      base += cols;
    }
  }

  function rmsNorm(input, gain, output, size) {
    let squares = 0;
    for (let index = 0; index < size; index++) {
      squares += input[index] * input[index];
    }
    const scale = 1 / Math.sqrt(squares / size + 1e-6);
    for (let index = 0; index < size; index++) {
      output[index] = input[index] * scale * gain[index];
    }
  }

  // ---- model -----------------------------------------------------------------------------------
  // Weight file layout (little endian), described by meta.tensors = [{ name, rows, cols, offset }]:
  //   matrix (cols > 0): float32 scale per row, then int8 values rows x cols; value = int8 * scale[row]
  //   vector (cols = 0): float32 x rows
  class Model {
    constructor(meta, buffer) {
      const config = meta.config;
      this.vocab = config.vocab;
      this.dim = config.dim;
      this.layers = config.layers;
      this.heads = config.heads;
      this.context = config.context;
      this.headDim = this.dim / this.heads;
      this.half = this.headDim / 2;
      this.tensors = {};
      for (const tensor of meta.tensors) {
        this.tensors[tensor.name] = this.readTensor(tensor, buffer);
      }
      this.blocks = [];
      for (let layer = 0; layer < this.layers; layer++) {
        const prefix = "blocks." + layer + ".";
        this.blocks.push({
          norm1: this.tensors[prefix + "norm1"],
          qkv: this.tensors[prefix + "qkv"],
          proj: this.tensors[prefix + "proj"],
          norm2: this.tensors[prefix + "norm2"],
          up: this.tensors[prefix + "up"],
          down: this.tensors[prefix + "down"],
          keys: new Float32Array(this.context * this.dim),
          values: new Float32Array(this.context * this.dim),
        });
      }
      this.embed = this.tensors.embed;
      this.finalNorm = this.tensors.norm;

      // Rotary tables, computed in float32 like the reference.
      this.cos = new Float32Array(this.context * this.half);
      this.sin = new Float32Array(this.context * this.half);
      for (let index = 0; index < this.half; index++) {
        const frequency = Math.fround(1 / Math.fround(Math.pow(10000, Math.fround(index / this.half))));
        for (let position = 0; position < this.context; position++) {
          const angle = Math.fround(position * frequency);
          this.cos[position * this.half + index] = Math.cos(angle);
          this.sin[position * this.half + index] = Math.sin(angle);
        }
      }

      this.x = new Float32Array(this.dim);
      this.normed = new Float32Array(this.dim);
      this.qkvOut = new Float32Array(3 * this.dim);
      this.attended = new Float32Array(this.dim);
      this.branch = new Float32Array(this.dim);
      this.hidden = new Float32Array(4 * this.dim);
      this.scores = new Float32Array(this.context);
      this.logits = new Float32Array(this.vocab);
      this.position = 0;
    }

    readTensor(tensor, buffer) {
      if (!tensor.cols) {
        return new Float32Array(buffer.slice(tensor.offset, tensor.offset + 4 * tensor.rows));
      }
      const scales = new Float32Array(buffer.slice(tensor.offset, tensor.offset + 4 * tensor.rows));
      const quantised = new Int8Array(buffer, tensor.offset + 4 * tensor.rows, tensor.rows * tensor.cols);
      const values = new Float32Array(tensor.rows * tensor.cols);
      let index = 0;
      for (let row = 0; row < tensor.rows; row++) {
        const scale = scales[row];
        for (let col = 0; col < tensor.cols; col++) {
          values[index] = quantised[index] * scale;
          index++;
        }
      }
      return values;
    }

    reset() {
      this.position = 0;
    }

    // Feed one token; returns the logits for the next token (a reused Float32Array).
    step(token) {
      const dim = this.dim;
      const heads = this.heads;
      const headDim = this.headDim;
      const half = this.half;
      const position = this.position;
      if (position >= this.context) {
        throw new Error("context is full");
      }
      const x = this.x;
      const normed = this.normed;
      const qkvOut = this.qkvOut;
      const attended = this.attended;
      const branch = this.branch;
      const hidden = this.hidden;
      const scores = this.scores;
      const rotaryBase = position * half;
      const attentionScale = 1 / Math.sqrt(headDim);

      x.set(this.embed.subarray(token * dim, (token + 1) * dim));
      for (let layer = 0; layer < this.layers; layer++) {
        const block = this.blocks[layer];
        rmsNorm(x, block.norm1, normed, dim);
        matVec(block.qkv, 3 * dim, dim, normed, qkvOut);

        // Rotate the query (offset 0) and the key (offset dim) by this position's angles.
        for (let which = 0; which < 2; which++) {
          for (let head = 0; head < heads; head++) {
            const start = which * dim + head * headDim;
            for (let index = 0; index < half; index++) {
              const cos = this.cos[rotaryBase + index];
              const sin = this.sin[rotaryBase + index];
              const first = qkvOut[start + index];
              const second = qkvOut[start + half + index];
              qkvOut[start + index] = first * cos - second * sin;
              qkvOut[start + half + index] = first * sin + second * cos;
            }
          }
        }
        block.keys.set(qkvOut.subarray(dim, 2 * dim), position * dim);
        block.values.set(qkvOut.subarray(2 * dim, 3 * dim), position * dim);

        for (let head = 0; head < heads; head++) {
          const start = head * headDim;
          let highest = -Infinity;
          for (let past = 0; past <= position; past++) {
            const keyBase = past * dim + start;
            let dot = 0;
            for (let index = 0; index < headDim; index++) {
              dot += qkvOut[start + index] * block.keys[keyBase + index];
            }
            dot *= attentionScale;
            scores[past] = dot;
            if (dot > highest) {
              highest = dot;
            }
          }
          let total = 0;
          for (let past = 0; past <= position; past++) {
            const weight = Math.exp(scores[past] - highest);
            scores[past] = weight;
            total += weight;
          }
          for (let index = 0; index < headDim; index++) {
            attended[start + index] = 0;
          }
          for (let past = 0; past <= position; past++) {
            const weight = scores[past] / total;
            const valueBase = past * dim + start;
            for (let index = 0; index < headDim; index++) {
              attended[start + index] += weight * block.values[valueBase + index];
            }
          }
        }
        matVec(block.proj, dim, dim, attended, branch);
        for (let index = 0; index < dim; index++) {
          x[index] += branch[index];
        }

        rmsNorm(x, block.norm2, normed, dim);
        matVec(block.up, 4 * dim, dim, normed, hidden);
        for (let index = 0; index < 4 * dim; index++) {
          const value = hidden[index];
          hidden[index] = 0.5 * value * (1 + Math.tanh(GELU_SCALE * (value + 0.044715 * value * value * value)));
        }
        matVec(block.down, dim, 4 * dim, hidden, branch);
        for (let index = 0; index < dim; index++) {
          x[index] += branch[index];
        }
      }
      rmsNorm(x, this.finalNorm, normed, dim);
      matVec(this.embed, this.vocab, dim, normed, this.logits);
      this.position = position + 1;
      return this.logits;
    }
  }

  // ---- sampling --------------------------------------------------------------------------------
  // Deterministic generator so the same seed tells the same tale.
  function makeRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The topK most likely tokens, most likely first, as [{ token, logit }]. `banned` tokens are skipped.
  function topTokens(logits, topK, banned) {
    const best = [];
    for (let token = 0; token < logits.length; token++) {
      const logit = logits[token];
      if (best.length === topK && logit <= best[topK - 1].logit) {
        continue;
      }
      if (banned && banned.has(token)) {
        continue;
      }
      let slot = best.length;
      while (slot > 0 && best[slot - 1].logit < logit) {
        slot--;
      }
      best.splice(slot, 0, { token: token, logit: logit });
      if (best.length > topK) {
        best.pop();
      }
    }
    return best;
  }

  // Returns { token, choices } where choices = the candidates with their probabilities.
  function sample(logits, options, random) {
    const temperature = options.temperature;
    const candidates = topTokens(logits, Math.max(1, options.topK || 40), options.banned);
    const sharpness = temperature > 0 ? 1 / temperature : 1;
    let total = 0;
    for (const candidate of candidates) {
      candidate.p = Math.exp((candidate.logit - candidates[0].logit) * sharpness);
      total += candidate.p;
    }
    for (const candidate of candidates) {
      candidate.p /= total;
    }
    if (!(temperature > 0)) {
      return { token: candidates[0].token, choices: candidates };
    }
    let threshold = random();
    for (const candidate of candidates) {
      threshold -= candidate.p;
      if (threshold <= 0) {
        return { token: candidate.token, choices: candidates };
      }
    }
    return { token: candidates[0].token, choices: candidates };
  }

  // ---- a writing session: keeps the token history and re-primes when the context window fills ----
  class Session {
    constructor(tokenizer, model) {
      this.tokenizer = tokenizer;
      this.model = model;
      this.tokens = [];
      this.logits = null;
    }

    // Start (or restart) from a full token history; only the newest part that fits is fed to the model.
    prime(tokens) {
      this.tokens = tokens.slice();
      this.refill(this.model.context - 1);
    }

    refill(keep) {
      const recent = this.tokens.slice(-keep);
      this.model.reset();
      this.logits = null;
      for (const token of recent) {
        this.logits = this.model.step(token);
      }
    }

    push(token) {
      this.tokens.push(token);
      if (this.model.position >= this.model.context) {
        this.refill(this.model.context >> 1);
      } else {
        this.logits = this.model.step(token);
      }
    }
  }

  root.GlowSparkEngine = {
    Tokenizer: Tokenizer,
    Model: Model,
    Session: Session,
    sample: sample,
    topTokens: topTokens,
    makeRandom: makeRandom,
    EOT_TEXT: EOT_TEXT,
  };
})(typeof self !== "undefined" ? self : this);
