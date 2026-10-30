/* AIRIZ wobble test core (1.11.19): pure maths for grading how much the camera head wobbles
 * while it rises up and down. No DOM access: the same file runs in the browser and in Node tests.
 *
 * Method. The camera rides on the rising head, so any wobble of the head shakes the camera
 * picture. While the head moves we track the picture frame by frame (sub-pixel block matching),
 * add the frame-to-frame shifts up to a path, remove the smooth part of the path (the travel
 * itself: a local straight-line fit with Gaussian weights, TREND_SIGMA_MS) and keep what is left:
 * the shake. Only the steady travel counts (the start and the stop of the move are left out),
 * and only the part across the travel direction (sideways) is graded.
 * Its size, as the peak-to-peak angle of the camera, is the wobble value.
 *
 * Grades (visual standard used at the bench, limit = grade 1):
 *   1 No wobbling          - not visible at 15 cm
 *   2 Very slight wobbling - visible at 15 cm, not at 30 cm
 *   3 Slight wobbling      - slightly visible at 30 cm
 *   4 Wobbling             - obviously visible at 30 cm
 * A movement is visible at distance D when it subtends more than a fixed angle at the eye, so
 * the visible size grows in proportion to D: what is just visible at 30 cm is twice what is just
 * visible at 15 cm. "Obvious" at 30 cm is taken as twice "just visible" at 30 cm. The grade
 * borders are therefore T, 2T and 4T, with T = the largest wobble that is still grade 1.
 * T is a setting: the default is an estimate (see DEFAULT_GRADE1_LIMIT_DEG) and the console can
 * fit T to units that were graded by eye (suggestGrade1Limit).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AirizWobbleCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Estimate for T (peak-to-peak camera angle): an eye at 15 cm notices an oscillation of about
  // 2 arc minutes, i.e. 0.09 mm; with about 40 mm from the head's pivot to its top that is
  // a rotation of about 0.12 degrees. Teach T from graded units for a real limit.
  const DEFAULT_GRADE1_LIMIT_DEG = 0.12;
  const DEFAULT_FOV_DEG = 70;      // horizontal field of view of the AIRIZ camera (setting)
  const TREND_SIGMA_MS = 150;      // trend fit width: slower movement counts as travel, not wobble
  const BORDER_FACTORS = [1, 2, 4];
  const GRADES = [
    { grade: 1, name: 'No wobbling', detail: 'Not visible at 15 cm' },
    { grade: 2, name: 'Very slight wobbling', detail: 'Visible at 15 cm, not at 30 cm' },
    { grade: 3, name: 'Slight wobbling', detail: 'Slightly visible at 30 cm' },
    { grade: 4, name: 'Wobbling', detail: 'Obviously visible at 30 cm' },
  ];

  // ------------------------------------------------------------------ frame matching

  function halve(gray, width, height) {
    const w = Math.floor(width / 2);
    const h = Math.floor(height / 2);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = 2 * y * width + 2 * x;
        out[y * w + x] = (gray[i] + gray[i + 1] + gray[i + width] + gray[i + width + 1]) / 4;
      }
    }
    return { gray: out, width: w, height: h };
  }

  // Mean |a(x,y) - b(x+dx, y+dy)| over the central region (a margin keeps every shift inside).
  function matchError(a, b, width, height, dx, dy, margin) {
    let sum = 0;
    let count = 0;
    for (let y = margin; y < height - margin; y += 1) {
      const rowA = y * width;
      const rowB = (y + dy) * width + dx;
      for (let x = margin; x < width - margin; x += 1) {
        sum += Math.abs(a[rowA + x] - b[rowB + x]);
        count += 1;
      }
    }
    return count ? sum / count : Infinity;
  }

  // Mean squared difference, used for the 2-D sub-pixel fit around the best whole-pixel match.
  function squaredError(a, b, width, height, dx, dy, margin) {
    let sum = 0;
    let count = 0;
    for (let y = margin; y < height - margin; y += 1) {
      const rowA = y * width;
      const rowB = (y + dy) * width + dx;
      for (let x = margin; x < width - margin; x += 1) {
        const difference = a[rowA + x] - b[rowB + x];
        sum += difference * difference;
        count += 1;
      }
    }
    return count ? sum / count : Infinity;
  }

  // Minimum of the paraboloid through a 3x3 grid of errors (e[j][i], i = dx + 1, j = dy + 1),
  // including the cross term, so a half-pixel shift in one axis does not bias the other.
  function paraboloidMinimum(e) {
    const dxx = e[1][0] - 2 * e[1][1] + e[1][2];
    const dyy = e[0][1] - 2 * e[1][1] + e[2][1];
    const dxy = (e[2][2] - e[2][0] - e[0][2] + e[0][0]) / 4;
    const gx = (e[1][2] - e[1][0]) / 2;
    const gy = (e[2][1] - e[0][1]) / 2;
    const det = dxx * dyy - dxy * dxy;
    if (!(dxx > 0) || !(dyy > 0) || !(det > 0)) return { x: 0, y: 0 };
    const x = -(dyy * gx - dxy * gy) / det;
    const y = -(dxx * gy - dxy * gx) / det;
    return { x: Math.max(-0.6, Math.min(0.6, x)), y: Math.max(-0.6, Math.min(0.6, y)) };
  }

  function contrastOf(gray) {
    let sum = 0;
    let squares = 0;
    for (let i = 0; i < gray.length; i += 1) {
      sum += gray[i];
      squares += gray[i] * gray[i];
    }
    const mean = sum / gray.length;
    return Math.sqrt(Math.max(0, squares / gray.length - mean * mean));
  }

  // How far the picture content moved from frame a to frame b, in pixels of these frames
  // (+x = content moved right, +y = content moved down), with sub-pixel precision.
  // maxShift: largest expected shift in pixels between the two frames.
  function measureShift(a, b, width, height, maxShift) {
    const range = Math.max(2, Math.ceil(maxShift || 8));
    // coarse search on half-size frames
    const ha = halve(a, width, height);
    const hb = halve(b, width, height);
    const coarseRange = Math.ceil(range / 2);
    const coarseMargin = coarseRange + 1;
    let best = Infinity;
    let cx = 0;
    let cy = 0;
    for (let dy = -coarseRange; dy <= coarseRange; dy += 1) {
      for (let dx = -coarseRange; dx <= coarseRange; dx += 1) {
        const error = matchError(ha.gray, hb.gray, ha.width, ha.height, dx, dy, coarseMargin);
        if (error < best) {
          best = error;
          cx = dx;
          cy = dy;
        }
      }
    }
    // refine at full size around the coarse match
    const margin = range + 3;
    let fx = cx * 2;
    let fy = cy * 2;
    best = Infinity;
    for (let dy = cy * 2 - 2; dy <= cy * 2 + 2; dy += 1) {
      for (let dx = cx * 2 - 2; dx <= cx * 2 + 2; dx += 1) {
        const error = matchError(a, b, width, height, dx, dy, margin);
        if (error < best) {
          best = error;
          fx = dx;
          fy = dy;
        }
      }
    }
    const grid = [];
    for (let j = -1; j <= 1; j += 1) {
      const row = [];
      for (let i = -1; i <= 1; i += 1) row.push(squaredError(a, b, width, height, fx + i, fy + j, margin));
      grid.push(row);
    }
    const left = grid[1][0];
    const right = grid[1][2];
    const up = grid[0][1];
    const down = grid[2][1];
    const centre = grid[1][1];
    const still = matchError(a, b, width, height, 0, 0, margin);
    const contrast = Math.min(contrastOf(a), contrastOf(b));
    // b(x + d) = a(x): the content moved by +d.
    const offset = paraboloidMinimum(grid);
    const shiftX = fx + offset.x;
    const shiftY = fy + offset.y;
    // How distinct the match is: neighbouring offsets must match clearly worse than the best one.
    const nearest = Math.min(left, right, up, down);
    const sharpness = nearest > 0 ? (nearest - centre) / nearest : 0;
    const confidence = contrast < 5 ? 0 : Math.max(0, Math.min(1, sharpness * 2));
    return { x: shiftX, y: shiftY, error: best, still, contrast, confidence };
  }

  // ------------------------------------------------------------------ wobble from a path

  function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((p, q) => p - q);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
    return sorted[index];
  }

  // samples: [{ t (ms), x, y }] cumulative picture position in pixels.
  // Returns the shake that remains after removing the smooth travel:
  // { peakToPeakPx, xPx, yPx, rmsPx, residual: [{t, x, y}], samples }.
  function wobbleFromPath(samples, options) {
    const sigmaMs = (options && options.sigmaMs) || TREND_SIGMA_MS;
    // only residuals between fromMs and toMs count (the fit itself may use all samples)
    const fromMs = options && Number.isFinite(options.fromMs) ? options.fromMs : -Infinity;
    const toMs = options && Number.isFinite(options.toMs) ? options.toMs : Infinity;
    const points = (samples || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length < 8) return { peakToPeakPx: 0, acrossPx: 0, alongPx: 0, xPx: 0, yPx: 0, rmsPx: 0, residual: [], samples: points.length };
    // Local straight-line fit with Gaussian weights (sigma 150 ms): steady travel leaves no
    // residual, also at the ends of the recording, and the high-pass has no overshoot:
    // shake at 3 Hz and faster counts fully (2 Hz about 83 %, 1 Hz about 36 %).
    const reach = 3 * sigmaMs;
    const residual = [];
    let first = 0;
    for (let i = 0; i < points.length; i += 1) {
      const centre = points[i].t;
      if (centre < fromMs || centre > toMs) continue;
      while (points[first].t < centre - reach) first += 1;
      let sw = 0;
      let st = 0;
      let stt = 0;
      let sx = 0;
      let sy = 0;
      let stx = 0;
      let sty = 0;
      for (let j = first; j < points.length && points[j].t <= centre + reach; j += 1) {
        const t = (points[j].t - centre) / 1000;
        const w = Math.exp(-0.5 * ((points[j].t - centre) / sigmaMs) ** 2);
        sw += w;
        st += w * t;
        stt += w * t * t;
        sx += w * points[j].x;
        sy += w * points[j].y;
        stx += w * t * points[j].x;
        sty += w * t * points[j].y;
      }
      // value of the weighted line at t = 0 (the centre)
      const det = sw * stt - st * st;
      let fitX = sx / sw;
      let fitY = sy / sw;
      if (det > 1e-12) {
        fitX = (stt * sx - st * stx) / det;
        fitY = (stt * sy - st * sty) / det;
      }
      residual.push({ t: centre, x: points[i].x - fitX, y: points[i].y - fitY });
    }
    if (!residual.length) return { peakToPeakPx: 0, acrossPx: 0, alongPx: 0, xPx: 0, yPx: 0, rmsPx: 0, residual: [], samples: points.length };
    const magnitudes = residual.map(point => Math.hypot(point.x, point.y));
    const rms = Math.sqrt(magnitudes.reduce((sum, value) => sum + value * value, 0) / magnitudes.length);
    // Split into across the travel (sideways: the wobble that is graded) and along it (also holds
    // the motor's speed ripple and frame-timing jitter, so it is reported but not graded).
    let dirX = options && options.direction ? options.direction.x : points[points.length - 1].x - points[0].x;
    let dirY = options && options.direction ? options.direction.y : points[points.length - 1].y - points[0].y;
    const dirLength = Math.hypot(dirX, dirY);
    if (dirLength > 1e-9) {
      dirX /= dirLength;
      dirY /= dirLength;
    } else {
      dirX = 0;
      dirY = 1; // rising: the picture travels up / down
    }
    for (const point of residual) point.across = point.x * dirY - point.y * dirX;
    const across = residual.map(point => Math.abs(point.across));
    const along = residual.map(point => Math.abs(point.x * dirX + point.y * dirY));
    return {
      peakToPeakPx: 2 * percentile(magnitudes, 0.95),
      acrossPx: 2 * percentile(across, 0.95),
      alongPx: 2 * percentile(along, 0.95),
      xPx: 2 * percentile(residual.map(point => Math.abs(point.x)), 0.95),
      yPx: 2 * percentile(residual.map(point => Math.abs(point.y)), 0.95),
      rmsPx: rms,
      residual,
      samples: points.length,
    };
  }

  // The steady part of a move: the start and the stop of the travel (the motor speeding up and
  // braking, or an abrupt start) bend the path and would count as wobble in the straight-line fit.
  // Keeps the samples from trimMs after the head starts moving until trimMs before it stops
  // (fromMs/toMs: pass them to wobbleFromPath so the fit still sees the samples around them).
  // "Moving" = more than 5 % of the travel away from the start / from the final position.
  function steadyPart(samples, options) {
    const trimMs = options && options.trimMs != null ? options.trimMs : 3 * TREND_SIGMA_MS + 100;
    const minMs = (options && options.minMs) || 600;
    const minTravelPx = options && options.minTravelPx != null ? options.minTravelPx : 3;
    const points = (samples || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length < 8) return { points, trimmed: false, travelPx: 0, moveMs: 0, fromMs: -Infinity, toMs: Infinity };
    const first = points[0];
    const last = points[points.length - 1];
    let travel = 0;
    for (const point of points) travel = Math.max(travel, Math.hypot(point.x - first.x, point.y - first.y));
    if (travel < minTravelPx) return { points, trimmed: false, travelPx: travel, moveMs: 0, fromMs: -Infinity, toMs: Infinity };
    const near = travel * 0.05;
    const startIndex = points.findIndex(point => Math.hypot(point.x - first.x, point.y - first.y) > near);
    let endIndex = points.length - 1;
    while (endIndex > 0 && Math.hypot(points[endIndex].x - last.x, points[endIndex].y - last.y) <= near) endIndex -= 1;
    const moveStart = points[Math.max(0, startIndex)].t;
    const moveEnd = points[Math.max(startIndex, endIndex)].t;
    let from = moveStart + trimMs;
    let to = moveEnd - trimMs;
    if (to - from < minMs) {
      // short move: keep the middle half
      const quarter = (moveEnd - moveStart) / 4;
      from = moveStart + quarter;
      to = moveEnd - quarter;
    }
    return {
      points: points.filter(point => point.t >= from && point.t <= to),
      trimmed: true,
      travelPx: travel,
      moveMs: moveEnd - moveStart,
      fromMs: from,
      toMs: to,
    };
  }

  // Remove the camera's own noise (measured while the head stands still) from a wobble value.
  function withoutNoise(value, noise) {
    return Math.sqrt(Math.max(0, value * value - (noise || 0) * (noise || 0)));
  }

  function pixelsToDegrees(pixels, frameWidth, fovDeg) {
    return (pixels / Math.max(1, frameWidth)) * (fovDeg || DEFAULT_FOV_DEG);
  }

  // ------------------------------------------------------------------ grades

  function gradeBorders(grade1Limit) {
    const limit = grade1Limit > 0 ? grade1Limit : DEFAULT_GRADE1_LIMIT_DEG;
    return BORDER_FACTORS.map(factor => factor * limit);
  }

  // Grade 1..4 for a wobble value (degrees peak to peak).
  function gradeFor(wobbleDeg, grade1Limit) {
    const borders = gradeBorders(grade1Limit);
    let grade = 1;
    for (const border of borders) {
      if (wobbleDeg > border) grade += 1;
    }
    return GRADES[grade - 1];
  }

  // Both directions of the test: the worse one decides. limitGrade = highest grade that passes.
  function summarize(results, grade1Limit, limitGrade) {
    const measured = (results || []).filter(item => item && Number.isFinite(item.wobbleDeg));
    if (!measured.length) return null;
    const worst = measured.reduce((a, b) => (b.wobbleDeg > a.wobbleDeg ? b : a));
    const grade = gradeFor(worst.wobbleDeg, grade1Limit);
    const limit = Math.max(1, Math.min(4, Number(limitGrade) || 1));
    const grade1 = grade1Limit > 0 ? grade1Limit : DEFAULT_GRADE1_LIMIT_DEG;
    return {
      grade: grade.grade,
      name: grade.name,
      detail: grade.detail,
      pass: grade.grade <= limit,
      limitGrade: limit,
      wobbleDeg: worst.wobbleDeg,
      worstDirection: worst.direction,
      ofGrade1Limit: worst.wobbleDeg / grade1,
    };
  }

  // Fit T to units graded by eye: pairs [{ wobbleDeg, grade }]. Picks the T that gives the
  // fewest wrong grades (ties: the middle of the best range). Returns null without data.
  function suggestGrade1Limit(pairs) {
    const usable = (pairs || []).filter(pair => pair.wobbleDeg > 0 && pair.grade >= 1 && pair.grade <= 4);
    if (!usable.length) return null;
    const candidates = new Set();
    for (const pair of usable) {
      for (const factor of BORDER_FACTORS) {
        candidates.add(pair.wobbleDeg / factor * 0.999);
        candidates.add(pair.wobbleDeg / factor * 1.001);
      }
    }
    const sorted = [...candidates].filter(value => value > 0).sort((a, b) => a - b);
    let bestErrors = Infinity;
    let bestRange = [];
    for (const limit of sorted) {
      const errors = usable.reduce((sum, pair) => sum + (gradeFor(pair.wobbleDeg, limit).grade === pair.grade ? 0 : 1), 0);
      if (errors < bestErrors) {
        bestErrors = errors;
        bestRange = [limit];
      } else if (errors === bestErrors) {
        bestRange.push(limit);
      }
    }
    // geometric middle of the best candidates
    const low = bestRange[0];
    const high = bestRange[bestRange.length - 1];
    return { grade1Limit: Math.sqrt(low * high), wrong: bestErrors, units: usable.length };
  }

  return {
    DEFAULT_GRADE1_LIMIT_DEG,
    DEFAULT_FOV_DEG,
    TREND_SIGMA_MS,
    GRADES,
    measureShift,
    wobbleFromPath,
    steadyPart,
    withoutNoise,
    pixelsToDegrees,
    gradeBorders,
    gradeFor,
    summarize,
    suggestGrade1Limit,
  };
});
