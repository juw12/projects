/* Sweep QR — a small QR Code encoder (byte mode, versions 1–40) used to link a phone to sync.
 * Follows the ISO/IEC 18004 construction as popularised by Project Nayuki's qrcodegen (MIT).
 * Usage: SweepQR.svg('https://…', { ecc: 'L', border: 4 }) → '<svg …>' string.
 */
(function () {
  'use strict';

  const ECC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
  const FORMAT_BITS = [1, 0, 3, 2];

  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  function getBit(value, index) {
    return ((value >>> index) & 1) !== 0;
  }

  function rawDataModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function dataCodewords(version, ecl) {
    return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
  }

  // ----- Reed–Solomon over GF(2^8) with polynomial 0x11D -----
  function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(function () { return 0; });
    data.forEach(function (byte) {
      const factor = byte ^ result.shift();
      result.push(0);
      divisor.forEach(function (coefficient, index) {
        result[index] ^= gfMultiply(coefficient, factor);
      });
    });
    return result;
  }

  function addEccAndInterleave(data, version, ecl) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version];
    const rawCodewords = Math.floor(rawDataModules(version) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
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
      blocks.forEach(function (block, j) {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  function encodeData(bytes, ecl) {
    let version = 1;
    for (; version <= 40; version++) {
      const countBits = version <= 9 ? 8 : 16;
      const usedBits = 4 + countBits + bytes.length * 8;
      if (bytes.length < (1 << countBits) && usedBits <= dataCodewords(version, ecl) * 8) break;
    }
    if (version > 40) throw new Error('Data too long for a QR code');
    const bits = [];
    const append = function (value, length) {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    append(0x4, 4);
    append(bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach(function (byte) { append(byte, 8); });
    const capacity = dataCodewords(version, ecl) * 8;
    append(0, Math.min(4, capacity - bits.length));
    append(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) append(pad, 8);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let value = 0;
      for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
      codewords.push(value);
    }
    return { version: version, codewords: codewords };
  }

  function alignmentPositions(version, size) {
    if (version === 1) return [];
    const numAlign = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function buildMatrix(version, ecl, allCodewords, mask) {
    const size = version * 4 + 17;
    const modules = [];
    const isFunction = [];
    for (let i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }
    const setFunction = function (x, y, dark) {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (center) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          const x = center[0] + dx;
          const y = center[1] + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    });
    const positions = alignmentPositions(version, size);
    const numAlign = positions.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFunction(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    const drawFormat = function (maskValue) {
      const data = FORMAT_BITS[ecl] << 3 | maskValue;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = (data << 10 | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFunction(8, i, getBit(bits, i));
      setFunction(8, 7, getBit(bits, 6));
      setFunction(8, 8, getBit(bits, 7));
      setFunction(7, 8, getBit(bits, 8));
      for (let i = 9; i < 15; i++) setFunction(14 - i, 8, getBit(bits, i));
      for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, getBit(bits, i));
      for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, getBit(bits, i));
      setFunction(8, size - 8, true);
    };
    drawFormat(0);

    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = version << 12 | rem;
      for (let i = 0; i < 18; i++) {
        const bit = getBit(bits, i);
        const a = size - 11 + i % 3;
        const b = Math.floor(i / 3);
        setFunction(a, b, bit);
        setFunction(b, a, bit);
      }
    }

    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < allCodewords.length * 8) {
            modules[y][x] = getBit(allCodewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex++;
          }
        }
      }
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = x * y % 2 + x * y % 3 === 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
    drawFormat(mask);
    return modules;
  }

  // Simplified penalty (runs, 2×2 blocks, finder-like patterns, balance) to pick a readable mask.
  function penalty(modules) {
    const size = modules.length;
    let score = 0;
    let dark = 0;
    const finderLike = function (line, index) {
      const pattern = [true, false, true, true, true, false, true];
      for (let k = 0; k < 7; k++) {
        if (line(index + k) !== pattern[k]) return false;
      }
      const before = [1, 2, 3, 4].every(function (k) { return index - k < 0 || !line(index - k); });
      const after = [1, 2, 3, 4].every(function (k) { return index + 6 + k >= size || !line(index + 6 + k); });
      return before || after;
    };
    for (let a = 0; a < size; a++) {
      const row = function (i) { return modules[a][i]; };
      const column = function (i) { return modules[i][a]; };
      [row, column].forEach(function (line) {
        let runColor = line(0);
        let runLength = 1;
        for (let i = 1; i <= size; i++) {
          if (i < size && line(i) === runColor) {
            runLength++;
          } else {
            if (runLength >= 5) score += runLength - 2;
            if (i < size) {
              runColor = line(i);
              runLength = 1;
            }
          }
        }
        for (let i = 0; i + 7 <= size; i++) {
          if (finderLike(line, i)) score += 40;
        }
      });
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
        if (x < size - 1 && y < size - 1) {
          const color = modules[y][x];
          if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3;
        }
      }
    }
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }

  function encode(text, options) {
    const ecl = ECC_LEVELS[(options && options.ecc) || 'M'];
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const encoded = encodeData(bytes, ecl);
    const allCodewords = addEccAndInterleave(encoded.codewords, encoded.version, ecl);
    let best = null;
    let bestMask = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const modules = buildMatrix(encoded.version, ecl, allCodewords, mask);
      const score = penalty(modules);
      if (score < bestScore) {
        best = modules;
        bestMask = mask;
        bestScore = score;
      }
    }
    return { version: encoded.version, size: best.length, modules: best, mask: bestMask };
  }

  function svg(text, options) {
    const qr = encode(text, options);
    const border = options && options.border !== undefined ? options.border : 4;
    const dimension = qr.size + border * 2;
    const parts = [];
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) parts.push('M' + (x + border) + ',' + (y + border) + 'h1v1h-1z');
      }
    }
    const label = (options && options.label) || 'QR code';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dimension + ' ' + dimension + '" shape-rendering="crispEdges" role="img" aria-label="' + label.replace(/"/g, '&quot;') + '">' +
      '<rect width="100%" height="100%" fill="#ffffff"/><path d="' + parts.join('') + '" fill="#000000"/></svg>';
  }

  window.SweepQR = { encode: encode, svg: svg };
})();
