/*
 * Stackup core — 1D tolerance stack-up math (worst case, RSS, Monte Carlo).
 * Pure functions, no DOM, no dependencies. Exposed as globalThis.StackupCore.
 *
 * Model
 *   Each contributor i has a nominal n, plus tolerance tp and minus tolerance tm
 *   (both entered as magnitudes), a sensitivity a (+1 / -1 for a 1D loop,
 *   0.5 for a diameter that acts as a radius, ...) and a distribution.
 *
 *   mean_i  = n + (tp - tm) / 2        (asymmetric tolerances shift the mean)
 *   half_i  = (tp + tm) / 2
 *   sigma_i = half_i / k        normal, tolerance = k sigma (k = 3 -> Cp 1.0)
 *           = half_i / sqrt(3)  uniform
 *           = half_i / sqrt(6)  symmetric triangular
 *
 *   gap mean  mu    = sum a_i mean_i
 *   worst case      = mu -/+ sum |a_i| half_i
 *   RSS sigma       = sqrt(sum (a_i sigma_i)^2)
 *   Cpk             = min(USL - mu, mu - LSL) / (3 sigma)
 */
(function (root) {
  "use strict";

  var DISTRIBUTIONS = {
    normal: { label: "Normal" },
    uniform: { label: "Uniform" },
    triangular: { label: "Triangular" }
  };

  function num(value, fallback) {
    var parsed = typeof value === "number" ? value : parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function isLimit(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  // Complementary error function, Numerical Recipes Chebyshev fit
  // (fractional error < 1.2e-7 everywhere).
  function erfc(x) {
    var z = Math.abs(x);
    var t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(
      -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277))))))))
    );
    return x >= 0 ? r : 2 - r;
  }

  function normCdf(z) {
    if (z === Infinity) {
      return 1;
    }
    if (z === -Infinity) {
      return 0;
    }
    return 0.5 * erfc(-z / Math.SQRT2);
  }

  function normalizeContributor(raw, index) {
    var dist = DISTRIBUTIONS[raw && raw.dist] ? raw.dist : "normal";
    return {
      id: (raw && raw.id) || "c" + (index + 1),
      label: String((raw && raw.label) || "Dimension " + (index + 1)),
      part: String((raw && raw.part) || ""),
      nominal: num(raw && raw.nominal, 0),
      tolPlus: Math.abs(num(raw && raw.tolPlus, 0)),
      tolMinus: Math.abs(num(raw && raw.tolMinus, 0)),
      sens: num(raw && raw.sens, 1),
      dist: dist,
      k: Math.max(0.5, num(raw && raw.k, 3))
    };
  }

  function normalizeStack(raw) {
    raw = raw || {};
    var contributors = (raw.contributors || []).map(normalizeContributor);
    return {
      id: raw.id || "stack-" + Date.now().toString(36),
      name: String(raw.name || "Untitled stack"),
      description: String(raw.description || ""),
      units: raw.units === "in" ? "in" : "mm",
      lsl: isLimit(raw.lsl) ? Number(raw.lsl) : null,
      usl: isLimit(raw.usl) ? Number(raw.usl) : null,
      targetCpk: Math.max(0.1, num(raw.targetCpk, 1.33)),
      samples: Math.min(500000, Math.max(1000, Math.round(num(raw.samples, 50000)))),
      seed: Math.round(num(raw.seed, 12345)),
      contributors: contributors
    };
  }

  function contributorStats(c) {
    var mean = c.nominal + (c.tolPlus - c.tolMinus) / 2;
    var half = (c.tolPlus + c.tolMinus) / 2;
    var sigma;
    if (c.dist === "uniform") {
      sigma = half / Math.sqrt(3);
    } else if (c.dist === "triangular") {
      sigma = half / Math.sqrt(6);
    } else {
      sigma = half / c.k;
    }
    return { mean: mean, half: half, sigma: sigma };
  }

  function cpkFor(mu, sigma, lsl, usl) {
    var sides = [];
    if (lsl !== null) {
      sides.push(mu - lsl);
    }
    if (usl !== null) {
      sides.push(usl - mu);
    }
    if (!sides.length) {
      return null;
    }
    var nearest = Math.min.apply(null, sides);
    if (sigma <= 0) {
      return nearest >= 0 ? Infinity : -Infinity;
    }
    return nearest / (3 * sigma);
  }

  function predictedOutFraction(mu, sigma, lsl, usl) {
    if (lsl === null && usl === null) {
      return null;
    }
    if (sigma <= 0) {
      var outside = (lsl !== null && mu < lsl) || (usl !== null && mu > usl);
      return outside ? 1 : 0;
    }
    var below = lsl !== null ? normCdf((lsl - mu) / sigma) : 0;
    var above = usl !== null ? 1 - normCdf((usl - mu) / sigma) : 0;
    return below + above;
  }

  function analyze(rawStack) {
    var stack = normalizeStack(rawStack);
    var nominalGap = 0;
    var mu = 0;
    var wcHalf = 0;
    var variance = 0;
    var rows = stack.contributors.map(function (c) {
      var s = contributorStats(c);
      var weightedSigma = Math.abs(c.sens) * s.sigma;
      nominalGap += c.sens * c.nominal;
      mu += c.sens * s.mean;
      wcHalf += Math.abs(c.sens) * s.half;
      variance += weightedSigma * weightedSigma;
      return {
        contributor: c,
        mean: s.mean,
        half: s.half,
        sigma: s.sigma,
        weightedHalf: Math.abs(c.sens) * s.half,
        weightedVar: weightedSigma * weightedSigma
      };
    });
    var sigma = Math.sqrt(variance);
    var lsl = stack.lsl;
    var usl = stack.usl;
    var wcMin = mu - wcHalf;
    var wcMax = mu + wcHalf;
    var cpk = cpkFor(mu, sigma, lsl, usl);
    var cp = lsl !== null && usl !== null && sigma > 0 ? (usl - lsl) / (6 * sigma) : null;
    var outFraction = predictedOutFraction(mu, sigma, lsl, usl);

    rows.forEach(function (row) {
      row.varShare = variance > 0 ? row.weightedVar / variance : 0;
      row.wcShare = wcHalf > 0 ? row.weightedHalf / wcHalf : 0;
      // What-if: halve this contributor's tolerance band, keep its mean.
      var reducedVar = variance - row.weightedVar + row.weightedVar / 4;
      row.cpkIfHalved = cpkFor(mu, Math.sqrt(Math.max(0, reducedVar)), lsl, usl);
    });

    var wcPass = (lsl === null || wcMin >= lsl - 1e-12) && (usl === null || wcMax <= usl + 1e-12);
    var hasSpec = lsl !== null || usl !== null;
    var verdict;
    if (!hasSpec) {
      verdict = "nospec";
    } else if (wcPass) {
      verdict = "pass-wc";
    } else if (cpk !== null && cpk >= stack.targetCpk) {
      verdict = "pass-stat";
    } else {
      verdict = "fail";
    }

    var lever = null;
    rows.forEach(function (row) {
      if (row.weightedVar <= 0) {
        return;
      }
      if (!lever || row.weightedVar > lever.weightedVar) {
        lever = row;
      }
    });

    return {
      stack: stack,
      rows: rows,
      nominalGap: nominalGap,
      mean: mu,
      wcHalf: wcHalf,
      wcMin: wcMin,
      wcMax: wcMax,
      sigma: sigma,
      rssMin: mu - 3 * sigma,
      rssMax: mu + 3 * sigma,
      cp: cp,
      cpk: cpk,
      outFraction: outFraction,
      ppm: outFraction === null ? null : outFraction * 1e6,
      wcPass: wcPass,
      verdict: verdict,
      lever: lever
    };
  }

  // Small, fast, seedable PRNG so Monte Carlo runs are reproducible.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function monteCarlo(rawStack, options) {
    var stack = normalizeStack(rawStack);
    options = options || {};
    var n = options.samples || stack.samples;
    var bins = options.bins || 60;
    var rand = mulberry32(options.seed !== undefined ? options.seed : stack.seed);
    var params = stack.contributors.map(function (c) {
      var s = contributorStats(c);
      return { sens: c.sens, dist: c.dist, mean: s.mean, half: s.half, sigma: s.sigma };
    });
    var values = new Float64Array(n);
    var sum = 0;
    var sumSq = 0;
    var min = Infinity;
    var max = -Infinity;
    var out = 0;
    var lsl = stack.lsl;
    var usl = stack.usl;
    var spare = null;

    function gauss() {
      if (spare !== null) {
        var cached = spare;
        spare = null;
        return cached;
      }
      var u = 0;
      var v = 0;
      while (u === 0) {
        u = rand();
      }
      v = rand();
      var mag = Math.sqrt(-2 * Math.log(u));
      spare = mag * Math.sin(2 * Math.PI * v);
      return mag * Math.cos(2 * Math.PI * v);
    }

    for (var i = 0; i < n; i++) {
      var gap = 0;
      for (var j = 0; j < params.length; j++) {
        var p = params[j];
        var x;
        if (p.dist === "uniform") {
          x = p.mean + (2 * rand() - 1) * p.half;
        } else if (p.dist === "triangular") {
          x = p.mean + (rand() + rand() - 1) * p.half;
        } else {
          x = p.mean + gauss() * p.sigma;
        }
        gap += p.sens * x;
      }
      values[i] = gap;
      sum += gap;
      sumSq += gap * gap;
      if (gap < min) {
        min = gap;
      }
      if (gap > max) {
        max = gap;
      }
      if ((lsl !== null && gap < lsl) || (usl !== null && gap > usl)) {
        out++;
      }
    }

    var mean = sum / n;
    var std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    var lo = min;
    var hi = max;
    if (hi - lo < 1e-12) {
      lo -= 0.5;
      hi += 0.5;
    }
    var counts = new Array(bins).fill(0);
    var width = (hi - lo) / bins;
    for (var b = 0; b < n; b++) {
      var idx = Math.min(bins - 1, Math.floor((values[b] - lo) / width));
      counts[idx]++;
    }

    return {
      samples: n,
      mean: mean,
      std: std,
      min: min,
      max: max,
      outCount: out,
      outFraction: out / n,
      histogram: { lo: lo, hi: hi, width: width, counts: counts }
    };
  }

  var PRESETS = [
    {
      id: "preset-gasket",
      name: "IPX7 front-cover gasket compression",
      description: "Squeeze on a die-cut silicone gasket between front cover rib and housing groove. Illustrative numbers \u2014 replace with your drawing values.",
      units: "mm",
      lsl: 0.35,
      usl: 0.65,
      targetCpk: 1.33,
      samples: 50000,
      seed: 12345,
      contributors: [
        { label: "Gasket free thickness", part: "Gasket", nominal: 1.6, tolPlus: 0.08, tolMinus: 0.08, sens: 1, dist: "normal", k: 3 },
        { label: "Groove depth", part: "Housing", nominal: 1.2, tolPlus: 0.05, tolMinus: 0.05, sens: -1, dist: "normal", k: 3 },
        { label: "Compression rib height", part: "Front cover", nominal: 0.3, tolPlus: 0.05, tolMinus: 0.05, sens: 1, dist: "normal", k: 3 },
        { label: "Cover stand-off at screw boss", part: "Front cover", nominal: 0.2, tolPlus: 0.05, tolMinus: 0.05, sens: -1, dist: "normal", k: 3 },
        { label: "Seal-face flatness", part: "Housing", nominal: 0, tolPlus: 0.05, tolMinus: 0.05, sens: -1, dist: "uniform", k: 3 }
      ]
    },
    {
      id: "preset-pcb",
      name: "PCB edge to housing wall clearance",
      description: "Side clearance between a PCB located on two bosses and the housing inner wall. Widths act through half (sensitivity 0.5). Illustrative numbers.",
      units: "mm",
      lsl: 0.2,
      usl: null,
      targetCpk: 1.33,
      samples: 50000,
      seed: 12345,
      contributors: [
        { label: "Housing inner width", part: "Housing", nominal: 60, tolPlus: 0.1, tolMinus: 0.1, sens: 0.5, dist: "normal", k: 3 },
        { label: "PCB width", part: "PCB", nominal: 58.8, tolPlus: 0.1, tolMinus: 0.1, sens: -0.5, dist: "normal", k: 3 },
        { label: "Locating hole position", part: "PCB", nominal: 0, tolPlus: 0.05, tolMinus: 0.05, sens: -1, dist: "normal", k: 3 },
        { label: "Boss true position", part: "Housing", nominal: 0, tolPlus: 0.05, tolMinus: 0.05, sens: -1, dist: "normal", k: 3 },
        { label: "Hole-to-boss float", part: "Assembly", nominal: 0, tolPlus: 0.1, tolMinus: 0.1, sens: -1, dist: "uniform", k: 3 }
      ]
    },
    {
      id: "preset-snap",
      name: "Snap-fit hook engagement",
      description: "Overlap between a cantilever hook and its catch window after assembly. Worst case misses the minimum but the process is capable. Illustrative numbers.",
      units: "mm",
      lsl: 0.3,
      usl: 0.75,
      targetCpk: 1.33,
      samples: 50000,
      seed: 12345,
      contributors: [
        { label: "Hook overhang", part: "Rear cover", nominal: 0.8, tolPlus: 0.05, tolMinus: 0.05, sens: 1, dist: "normal", k: 3 },
        { label: "Assembly gap", part: "Assembly", nominal: 0.3, tolPlus: 0.06, tolMinus: 0.06, sens: -1, dist: "normal", k: 3 },
        { label: "Hook base position", part: "Rear cover", nominal: 0, tolPlus: 0.05, tolMinus: 0.05, sens: -1, dist: "normal", k: 3 },
        { label: "Catch window position", part: "Front cover", nominal: 0, tolPlus: 0.05, tolMinus: 0.05, sens: -1, dist: "normal", k: 3 }
      ]
    }
  ];

  function toCsv(rawStack) {
    var result = analyze(rawStack);
    var s = result.stack;
    var lines = [];
    function cell(value) {
      var text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }
    function round(value) {
      return value === null || !isFinite(value) ? "" : Number(value.toFixed(6));
    }
    lines.push(["Stack", s.name].map(cell).join(","));
    lines.push(["Units", s.units].map(cell).join(","));
    lines.push(["LSL", s.lsl === null ? "" : s.lsl].map(cell).join(","));
    lines.push(["USL", s.usl === null ? "" : s.usl].map(cell).join(","));
    lines.push("");
    lines.push(["#", "Dimension", "Part", "Nominal", "Tol +", "Tol -", "Sensitivity", "Distribution", "k (sigma at tol)", "Mean", "Sigma", "Variance share %"].map(cell).join(","));
    result.rows.forEach(function (row, i) {
      var c = row.contributor;
      lines.push([
        i + 1, c.label, c.part, c.nominal, c.tolPlus, c.tolMinus, c.sens, c.dist, c.k,
        round(row.mean), round(row.sigma), round(row.varShare * 100)
      ].map(cell).join(","));
    });
    lines.push("");
    lines.push(["Nominal gap", round(result.nominalGap)].map(cell).join(","));
    lines.push(["Mean gap", round(result.mean)].map(cell).join(","));
    lines.push(["Worst case min", round(result.wcMin)].map(cell).join(","));
    lines.push(["Worst case max", round(result.wcMax)].map(cell).join(","));
    lines.push(["RSS sigma", round(result.sigma)].map(cell).join(","));
    lines.push(["RSS -3 sigma", round(result.rssMin)].map(cell).join(","));
    lines.push(["RSS +3 sigma", round(result.rssMax)].map(cell).join(","));
    lines.push(["Cpk", round(result.cpk)].map(cell).join(","));
    lines.push(["Predicted out of spec (ppm)", round(result.ppm)].map(cell).join(","));
    return lines.join("\n") + "\n";
  }

  root.StackupCore = {
    version: "1.0.0",
    DISTRIBUTIONS: DISTRIBUTIONS,
    PRESETS: PRESETS,
    normCdf: normCdf,
    normalizeStack: normalizeStack,
    contributorStats: contributorStats,
    analyze: analyze,
    monteCarlo: monteCarlo,
    mulberry32: mulberry32,
    toCsv: toCsv
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
