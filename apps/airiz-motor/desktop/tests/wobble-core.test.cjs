'use strict';
// 1.11.19 wobble test: sub-pixel tracking, wobble value, grades and teaching from graded units.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const WEB = path.join(__dirname, '..', '..', 'web');
const core = require(path.join(WEB, 'wobble-core.js'));

const WIDTH = 240;
const HEIGHT = 180;

// A detailed, smooth test scene that can be sampled at any sub-pixel position.
function scene(x, y) {
  return 128
    + 40 * Math.sin(x * 0.21 + 1.3) * Math.cos(y * 0.17)
    + 30 * Math.sin((x + 2 * y) * 0.093)
    + 25 * Math.cos((3 * x - y) * 0.051 + 0.7)
    + 20 * Math.sin(Math.hypot(x - 90, y - 70) * 0.31);
}

// Frame of the scene with the camera content shifted by (ox, oy) pixels.
function frame(ox, oy) {
  const gray = new Uint8ClampedArray(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) gray[y * WIDTH + x] = scene(x - ox, y - oy);
  }
  return gray;
}

// Simulated rising move: steady vertical travel plus a sideways and vertical shake.
function track(amplitudePx, frequencyHz, seconds, fps) {
  const samples = [];
  let previous = null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i <= seconds * fps; i += 1) {
    const t = (i / fps) * 1000;
    const shake = amplitudePx * Math.sin(2 * Math.PI * frequencyHz * t / 1000);
    const ox = shake;
    const oy = 1.5 * i + 0.5 * shake;
    const current = frame(ox, oy);
    if (previous) {
      const shift = core.measureShift(previous, current, WIDTH, HEIGHT, 6);
      sumX += shift.x;
      sumY += shift.y;
    }
    samples.push({ t, x: sumX, y: sumY });
    previous = current;
  }
  return samples;
}

test('measureShift finds sub-pixel shifts in both directions', () => {
  const base = frame(0, 0);
  for (const [dx, dy] of [[0.3, 0], [-1.7, 0.4], [2.25, -3.6], [0, 0]]) {
    const shift = core.measureShift(base, frame(dx, dy), WIDTH, HEIGHT, 6);
    assert.ok(Math.abs(shift.x - dx) < 0.12, `x ${shift.x} vs ${dx}`);
    assert.ok(Math.abs(shift.y - dy) < 0.12, `y ${shift.y} vs ${dy}`);
    assert.ok(shift.confidence > 0.3);
  }
});

test('a flat picture gives no confidence', () => {
  const flat = new Uint8ClampedArray(WIDTH * HEIGHT).fill(120);
  assert.equal(core.measureShift(flat, flat, WIDTH, HEIGHT, 6).confidence, 0);
});

test('wobble value follows the real shake and ignores the travel itself', () => {
  const steady = core.wobbleFromPath(track(0, 6, 2, 30));
  assert.ok(steady.peakToPeakPx < 0.2, 'smooth travel is not wobble: ' + steady.peakToPeakPx);
  for (const amplitude of [0.4, 1, 2]) {
    const result = core.wobbleFromPath(track(amplitude, 6, 2, 30));
    // shake magnitude sqrt(1 + 0.25) * amplitude, peak to peak
    const expected = 2 * amplitude * Math.sqrt(1.25);
    assert.ok(Math.abs(result.peakToPeakPx - expected) < 0.2 * expected + 0.1,
      `amplitude ${amplitude}: ${result.peakToPeakPx.toFixed(2)} vs ${expected.toFixed(2)}`);
  }
});

test('grades use the borders T, 2T and 4T (15 cm / 30 cm visibility)', () => {
  const limit = 0.1;
  assert.deepEqual(core.gradeBorders(limit).map(value => +value.toFixed(3)), [0.1, 0.2, 0.4]);
  assert.equal(core.gradeFor(0.05, limit).grade, 1);
  assert.equal(core.gradeFor(0.1, limit).grade, 1);
  assert.equal(core.gradeFor(0.15, limit).grade, 2);
  assert.equal(core.gradeFor(0.3, limit).grade, 3);
  assert.equal(core.gradeFor(0.9, limit).grade, 4);
  assert.equal(core.gradeFor(0.15, limit).name, 'Very slight wobbling');
});

test('the worse direction decides; limit grade 1 passes only grade 1', () => {
  const up = { direction: 'up', wobbleDeg: 0.05 };
  const down = { direction: 'down', wobbleDeg: 0.15 };
  const summary = core.summarize([up, down], 0.1, 1);
  assert.equal(summary.grade, 2);
  assert.equal(summary.worstDirection, 'down');
  assert.equal(summary.pass, false);
  assert.equal(core.summarize([up], 0.1, 1).pass, true);
  assert.equal(core.summarize([up, down], 0.1, 2).pass, true);
  assert.equal(core.summarize([], 0.1, 1), null);
});

test('camera noise is removed, pixels convert to degrees', () => {
  assert.equal(core.withoutNoise(0.5, 0.3).toFixed(2), '0.40');
  assert.equal(core.withoutNoise(0.2, 0.3), 0);
  assert.equal(core.pixelsToDegrees(32, 320, 70), 7);
});

test('the grade-1 limit can be taught from units graded by eye', () => {
  // true T = 0.1 degrees
  const pairs = [
    { wobbleDeg: 0.04, grade: 1 }, { wobbleDeg: 0.08, grade: 1 },
    { wobbleDeg: 0.13, grade: 2 }, { wobbleDeg: 0.18, grade: 2 },
    { wobbleDeg: 0.28, grade: 3 }, { wobbleDeg: 0.6, grade: 4 },
  ];
  const fit = core.suggestGrade1Limit(pairs);
  assert.equal(fit.wrong, 0);
  assert.ok(fit.grade1Limit > 0.08 && fit.grade1Limit < 0.13, String(fit.grade1Limit));
  for (const pair of pairs) assert.equal(core.gradeFor(pair.wobbleDeg, fit.grade1Limit).grade, pair.grade);
  assert.equal(core.suggestGrade1Limit([]), null);
});

test('the start and the stop of the travel are not counted as wobble', () => {
  // 3 s move at 40 px/s with an abrupt start and stop, still before and after, 30 fps
  const makePath = wobblePx => {
    const samples = [];
    for (let t = 0; t <= 6000; t += 33.3) {
      const moving = Math.min(1, Math.max(0, (t - 1000) / 3000));
      const inMove = t > 1000 && t < 4000;
      const sideways = inMove ? (wobblePx / 2) * Math.sin(2 * Math.PI * 4 * (t - 1000) / 1000) : 0;
      samples.push({ t, x: sideways, y: moving * 120 });
    }
    return samples;
  };
  const whole = core.wobbleFromPath(makePath(0));
  assert.ok(whole.peakToPeakPx > 1, 'the corners alone look like wobble: ' + whole.peakToPeakPx);
  const steady = core.steadyPart(makePath(0));
  assert.equal(steady.trimmed, true);
  assert.ok(steady.moveMs > 2600 && steady.moveMs < 3000, 'move found: ' + steady.moveMs);
  const range = part => ({ fromMs: part.fromMs, toMs: part.toMs });
  assert.ok(core.wobbleFromPath(makePath(0), range(steady)).peakToPeakPx < 0.01);
  const shaking = core.wobbleFromPath(makePath(0.5), range(core.steadyPart(makePath(0.5))));
  assert.ok(Math.abs(shaking.peakToPeakPx - 0.5) < 0.06, 'measured ' + shaking.peakToPeakPx);
  // a still recording is kept whole
  const still = core.steadyPart([...Array(30)].map((_, i) => ({ t: i * 33, x: 0.01 * (i % 2), y: 0 })));
  assert.equal(still.trimmed, false);
  assert.equal(still.points.length, 30);
});

test('wobble test is wired into the console (card, script, offline cache)', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  assert.ok(html.includes('id="wobble-test"') && html.includes('id="wobble-start"'));
  assert.ok(html.includes('src="wobble-core.js"') && html.includes('src="wobble.js"'));
  assert.ok(sw.includes("'./wobble-core.js'") && sw.includes("'./wobble.js'"));
});

test('only the sideways shake is graded; along-travel ripple is reported separately', () => {
  const samples = [];
  for (let t = 0; t <= 3000; t += 33.3) {
    // vertical travel with along-travel ripple 0.6 px and sideways shake 0.3 px (peak to peak), 5 Hz
    const ripple = 0.3 * Math.sin(2 * Math.PI * 5 * t / 1000);
    const sideways = 0.15 * Math.sin(2 * Math.PI * 5 * t / 1000 + 1);
    samples.push({ t, x: sideways, y: 40 * t / 1000 + ripple });
  }
  const shake = core.wobbleFromPath(samples);
  assert.ok(Math.abs(shake.acrossPx - 0.3) < 0.03, 'across ' + shake.acrossPx);
  assert.ok(Math.abs(shake.alongPx - 0.6) < 0.06, 'along ' + shake.alongPx);
  assert.ok(shake.residual.every(point => Number.isFinite(point.across)));
});

// Full measurement pipeline on rendered frames: a smooth random scene sampled at sub-pixel
// offsets, camera noise and 8-bit rounding, 30 fps, 240 px wide, 70 deg view. The head travels
// 120 px in about 5.9 s (abrupt start and stop) and shakes sideways at 3 Hz by a known angle.
function makeScene(width, height, seed) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  let values = new Float32Array(width * height).map(() => random() * 255);
  for (let pass = 0; pass < 2; pass += 1) {
    const blurred = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const sx = Math.min(width - 1, Math.max(0, x + dx));
            const sy = Math.min(height - 1, Math.max(0, y + dy));
            sum += values[sy * width + sx];
            count += 1;
          }
        }
        blurred[y * width + x] = sum / count;
      }
    }
    values = blurred;
  }
  // stretch the contrast back after blurring
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return { width, height, values: values.map(value => ((value - low) / (high - low)) * 220 + 15) };
}

function renderFrame(scene, offsetX, offsetY, width, height, noise) {
  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x + offsetX;
      const sy = y + offsetY;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const at = (px, py) => scene.values[py * scene.width + px];
      const value = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy)
        + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      gray[y * width + x] = Math.round(value + noise());
    }
  }
  return gray;
}

function measureRun(wobbleDeg, frequencyHz) {
  const width = 240;
  const height = 135;
  const fov = 70;
  const fps = 30;
  const scene = makeScene(width + 40, height + 180, 4242);
  let noiseState = 99;
  const noise = () => {
    // about 1 gray level of sensor noise (sum of uniforms)
    let sum = 0;
    for (let i = 0; i < 4; i += 1) {
      noiseState = (noiseState * 1664525 + 1013904223) % 4294967296;
      sum += noiseState / 4294967296 - 0.5;
    }
    return sum * 1.7;
  };
  const amplitudePx = (wobbleDeg / (fov / width)) / 2;
  const track = (frames, moving) => {
    const path = [{ t: 0, x: 0, y: 0 }];
    let x = 0;
    let y = 0;
    for (let i = 1; i < frames.length; i += 1) {
      const shift = core.measureShift(frames[i - 1], frames[i], width, height, 16);
      x += shift.x;
      y += shift.y;
      path.push({ t: (i * 1000) / fps, x, y });
    }
    return path;
  };
  // 1 s still: camera noise only
  const still = [];
  for (let i = 0; i < fps; i += 1) still.push(renderFrame(scene, 20, 20, width, height, noise));
  const noisePath = track(still);
  const noiseShake = core.wobbleFromPath(noisePath, { direction: { x: 0, y: 1 } });
  // the move: 0.6 s still, 5.9 s travel, 1.2 s still
  const frames = [];
  const moveMs = 5900;
  for (let t = 0; t <= 600 + moveMs + 1200; t += 1000 / fps) {
    const share = Math.min(1, Math.max(0, (t - 600) / moveMs));
    const inMove = share > 0 && share < 1;
    const sideways = inMove ? amplitudePx * Math.sin(2 * Math.PI * frequencyHz * (t - 600) / 1000) : 0;
    frames.push(renderFrame(scene, 20 + sideways, 20 + share * 120, width, height, noise));
  }
  const path = track(frames);
  const steady = core.steadyPart(path);
  const shake = core.wobbleFromPath(path, { fromMs: steady.fromMs, toMs: steady.toMs });
  const cleanPx = core.withoutNoise(shake.acrossPx, noiseShake.acrossPx);
  return {
    wobbleDeg: core.pixelsToDegrees(cleanPx, width, fov),
    noiseDeg: core.pixelsToDegrees(noiseShake.acrossPx, width, fov),
  };
}

test('full pipeline on rendered camera frames measures and grades a known wobble', () => {
  const limit = core.DEFAULT_GRADE1_LIMIT_DEG;
  const cases = [
    { wobbleDeg: 0, grade: 1 },
    { wobbleDeg: 0.18, grade: 2 },
    { wobbleDeg: 0.34, grade: 3 },
    { wobbleDeg: 0.8, grade: 4 },
  ];
  for (const item of cases) {
    const measured = measureRun(item.wobbleDeg, 3);
    const grade = core.gradeFor(measured.wobbleDeg, limit).grade;
    assert.equal(grade, item.grade, `true ${item.wobbleDeg} deg measured ${measured.wobbleDeg.toFixed(3)} deg`);
    if (item.wobbleDeg > 0) {
      const error = Math.abs(measured.wobbleDeg - item.wobbleDeg) / item.wobbleDeg;
      assert.ok(error < 0.15, `true ${item.wobbleDeg} deg measured ${measured.wobbleDeg.toFixed(3)} deg`);
    } else {
      assert.ok(measured.wobbleDeg < limit / 3, 'still head measured ' + measured.wobbleDeg.toFixed(3));
    }
    assert.ok(measured.noiseDeg < limit / 4, 'camera noise ' + measured.noiseDeg.toFixed(3));
  }
});
