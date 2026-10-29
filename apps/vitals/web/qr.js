/* Minimal QR Code generator (byte mode, error correction M, versions 1–10).
 * Enough for pairing URLs (~60 characters). No dependencies, works offline.
 * Algorithm follows ISO/IEC 18004; structure inspired by Project Nayuki's
 * public-domain-style reference design. Exposes window.VitalsQR. */
(function (root) {
  "use strict";

  const ECC = {
    M: { formatBits: 0, codewords: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
    L: { formatBits: 1, codewords: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
  };
  const MAX_VERSION = 10;

  const getBit = (x, i) => ((x >>> i) & 1) !== 0;

  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8) - ecl.codewords[ver] * ecl.blocks[ver];
  }

  // ---------------------------------------------------------- Reed–Solomon
  function rsMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let rootValue = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = rsMultiply(result[j], rootValue);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      rootValue = rsMultiply(rootValue, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => {
        result[i] ^= rsMultiply(coef, factor);
      });
    }
    return result;
  }

  // -------------------------------------------------------------- encoding
  function toUtf8(text) {
    return Array.from(new TextEncoder().encode(text));
  }

  function encodeData(bytes, ver, ecl) {
    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0x4, 4); // byte mode
    push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    const capacity = numDataCodewords(ver, ecl) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      out.push(byte);
    }
    return out;
  }

  function addEccAndInterleave(data, ver, ecl) {
    const numBlocks = ecl.blocks[ver];
    const blockEccLen = ecl.codewords[ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const divisor = rsDivisor(blockEccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  // ---------------------------------------------------------------- matrix
  function build(ver, ecl, codewords, forcedMask) {
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }
    const finder = (x, y) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    const align = alignmentPositions(ver, size);
    align.forEach((ax, i) => {
      align.forEach((ay, j) => {
        const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
        if (corner) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });

    const drawFormat = (mask) => {
      const data = (ecl.formatBits << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i));
      setFn(8, 7, getBit(bits, 6));
      setFn(8, 8, getBit(bits, 7));
      setFn(7, 8, getBit(bits, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = getBit(bits, i);
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFn(a, b, bit);
        setFn(b, a, bit);
      }
    }

    // Data, zig-zagging up and down in two-module columns.
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
            modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex++;
          }
        }
      }
    }

    const applyMask = (mask) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let invert;
          switch (mask) {
            case 0: invert = (x + y) % 2 === 0; break;
            case 1: invert = y % 2 === 0; break;
            case 2: invert = x % 3 === 0; break;
            case 3: invert = (x + y) % 3 === 0; break;
            case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
            case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
            default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          }
          if (!isFunction[y][x] && invert) modules[y][x] = !modules[y][x];
        }
      }
    };

    let mask = forcedMask;
    if (mask == null) {
      let best = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m);
        drawFormat(m);
        const score = penalty(modules, size);
        if (score < best) {
          best = score;
          mask = m;
        }
        applyMask(m); // XOR again to undo
      }
    }
    applyMask(mask);
    drawFormat(mask);
    return { size, modules, mask, version: ver };
  }

  function alignmentPositions(ver, size) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function penalty(modules, size) {
    let score = 0;
    const line = (get) => {
      let runColor = null;
      let runLength = 0;
      const row = [];
      for (let i = 0; i < size; i++) {
        const c = get(i);
        row.push(c);
        if (c === runColor) {
          runLength++;
          if (runLength === 5) score += 3;
          else if (runLength > 5) score += 1;
        } else {
          runColor = c;
          runLength = 1;
        }
      }
      // Finder-like 1:1:3:1:1 with four light modules on one side (edges count as light).
      const padded = [false, false, false, false].concat(row, [false, false, false, false]);
      const pattern = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= padded.length; i++) {
        if (pattern.every((p, k) => padded[i + k] === p)) {
          const before = padded.slice(Math.max(0, i - 4), i);
          const after = padded.slice(i + 7, i + 11);
          if ((before.length === 4 && before.every((v) => !v)) || (after.length === 4 && after.every((v) => !v))) score += 40;
        }
      }
    };
    for (let y = 0; y < size; y++) line((x) => modules[y][x]);
    for (let x = 0; x < size; x++) line((y) => modules[y][x]);
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
        if (x < size - 1 && y < size - 1) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
        }
      }
    }
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function encode(text, options) {
    const opts = options || {};
    const ecl = ECC[opts.ecc || "M"];
    const bytes = toUtf8(text);
    for (let ver = opts.version || 1; ver <= MAX_VERSION; ver++) {
      const needed = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
      if (needed <= numDataCodewords(ver, ecl) * 8) {
        const data = encodeData(bytes, ver, ecl);
        return build(ver, ecl, addEccAndInterleave(data, ver, ecl), opts.mask);
      }
      if (opts.version) break;
    }
    throw new Error("Text too long for a QR code");
  }

  function toSvg(qr, options) {
    const opts = options || {};
    const border = opts.border == null ? 4 : opts.border;
    const dim = qr.size + border * 2;
    let path = "";
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) path += "M" + (x + border) + "," + (y + border) + "h1v1h-1z";
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim + '" shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || "QR code") + '">' +
      '<rect width="100%" height="100%" fill="' + (opts.light || "#fff") + '"/><path d="' + path + '" fill="' + (opts.dark || "#000") + '"/></svg>';
  }

  root.VitalsQR = { encode, toSvg };
})(typeof window !== "undefined" ? window : globalThis);
