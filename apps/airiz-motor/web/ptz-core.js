/* AIRIZ PTZ core (1.8.0): pure logic for the PTZ & smart-camera features.
 *
 * The AIRIZ motors are open loop: `diag motor pan|rising forward|reverse SPEED STEPS`
 * starts a timed move and the firmware reports no position. This module therefore keeps
 * the position in software (sum of every motor command sent from this console, from any
 * view), with soft limits, and contains the maths for presets, click-to-center,
 * calibration, motion detection, auto-tracking and automatic night mode.
 * No DOM access here: the same file runs in the browser and in Node unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AirizPtzCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AXES = ['pan', 'rising'];
  // Firmware ranges (data/commands.js): pan speed 1-17, rising speed 1-30, steps 1-99999.
  const SPEED_RANGE = { pan: [1, 17], rising: [1, 30] };
  const MAX_STEPS = 99999;
  const MOTOR_RE = /^\s*diag\s+motor\s+(pan|rising)\s+(forward|reverse)\s+(\d+)\s+(\d+)\s*$/i;
  const STOP_RE = /^\s*(stop|diag\s+motor\s+stop|echo\s+0\s*>\s*\/sys\/devices\/platform\/soc\/soc:motor\/status)\s*$/i;

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  // ------------------------------------------------------------------ commands

  function parseMotorCommand(line) {
    const match = MOTOR_RE.exec(String(line || ''));
    if (!match) return null;
    const steps = Number(match[4]);
    return {
      axis: match[1].toLowerCase(),
      direction: match[2].toLowerCase() === 'forward' ? 1 : -1,
      speed: Number(match[3]),
      steps,
      delta: (match[2].toLowerCase() === 'forward' ? 1 : -1) * steps
    };
  }

  function isStopCommand(line) {
    return STOP_RE.test(String(line || ''));
  }

  // Positive delta = forward (pan forward / rising up).
  function motorCommand(axis, delta, speed) {
    if (!AXES.includes(axis)) throw new Error('Unknown axis ' + axis);
    const steps = Math.round(Math.abs(delta));
    if (!steps) return null;
    if (steps > MAX_STEPS) throw new Error('Move too large (' + steps + ' steps).');
    const [low, high] = SPEED_RANGE[axis];
    const value = clamp(Math.round(Number(speed) || low), low, high);
    return 'diag motor ' + axis + ' ' + (delta > 0 ? 'forward' : 'reverse') + ' ' + value + ' ' + steps;
  }

  // ------------------------------------------------------------------ timing model
  // "Smaller speed = slower & stronger" (firmware note), so the time per step is modelled
  // as k / speed. k per axis comes from a measured move (Calibration) or the defaults.
  const DEFAULT_TIMING = { pan: 40, rising: 12 };

  function msPerStep(axis, speed, timing) {
    const k = (timing && Number(timing[axis])) || DEFAULT_TIMING[axis];
    return k / Math.max(1, Number(speed) || 1);
  }

  function estimateMoveMs(axis, steps, speed, timing) {
    return Math.abs(steps) * msPerStep(axis, speed, timing);
  }

  // From a measured move: k = measured_ms * speed / steps.
  function timingFromMeasurement(steps, speed, measuredMs) {
    if (!(steps > 0) || !(measuredMs > 0)) return null;
    return (measuredMs * Math.max(1, speed)) / steps;
  }

  // ------------------------------------------------------------------ position tracker

  function emptyLimits() {
    return { pan: { min: null, max: null }, rising: { min: null, max: null } };
  }

  function createTracker(saved) {
    const data = saved && typeof saved === 'object' ? saved : {};
    const state = {
      position: { pan: Number(data.position && data.position.pan) || 0, rising: Number(data.position && data.position.rising) || 0 },
      limits: Object.assign(emptyLimits(), data.limits || {}),
      uncertain: !!data.uncertain,
      homed: !!data.homed,
      pending: null // move in flight: { axis, delta, startedAt, expectedMs }
    };

    function limitFor(axis) {
      const limit = state.limits[axis] || {};
      return {
        min: Number.isFinite(limit.min) ? limit.min : -Infinity,
        max: Number.isFinite(limit.max) ? limit.max : Infinity
      };
    }

    // Largest part of `delta` that keeps the axis inside its soft limits.
    function clampDelta(axis, delta) {
      const { min, max } = limitFor(axis);
      const target = clamp(state.position[axis] + delta, min, max);
      return Math.round(target - state.position[axis]);
    }

    // Record a command that was really sent (from any view, macro or controller).
    function applyCommand(line, now, timing) {
      const move = parseMotorCommand(line);
      if (move) {
        settlePending(now);
        state.position[move.axis] += move.delta;
        state.pending = {
          axis: move.axis,
          delta: move.delta,
          startedAt: now,
          expectedMs: estimateMoveMs(move.axis, move.steps, move.speed, timing)
        };
        return { type: 'move', move };
      }
      if (isStopCommand(line)) {
        const partial = interruptPending(now);
        return { type: 'stop', partial };
      }
      return null;
    }

    function settlePending(now) {
      if (state.pending && now - state.pending.startedAt >= state.pending.expectedMs) state.pending = null;
    }

    // A stop during a move: the move ran only part of its steps. Estimate how far from
    // the elapsed time and mark the position as estimated until the next re-home.
    function interruptPending(now) {
      const pending = state.pending;
      state.pending = null;
      if (!pending) return null;
      const elapsed = Math.max(0, now - pending.startedAt);
      if (elapsed >= pending.expectedMs) return null;
      const fraction = pending.expectedMs > 0 ? elapsed / pending.expectedMs : 1;
      const done = Math.round(pending.delta * fraction);
      state.position[pending.axis] -= pending.delta - done;
      state.uncertain = true;
      return { axis: pending.axis, planned: pending.delta, done };
    }

    function busyUntil() {
      return state.pending ? state.pending.startedAt + state.pending.expectedMs : 0;
    }

    function setHome() {
      state.position = { pan: 0, rising: 0 };
      state.uncertain = false;
      state.homed = true;
      state.pending = null;
    }

    function setAxisZero(axis) {
      const shift = state.position[axis];
      state.position[axis] = 0;
      const limit = state.limits[axis];
      if (Number.isFinite(limit.min)) limit.min -= shift;
      if (Number.isFinite(limit.max)) limit.max -= shift;
    }

    function setLimit(axis, side, value) {
      const limit = state.limits[axis];
      limit[side] = value === null ? null : Math.round(value);
      if (Number.isFinite(limit.min) && Number.isFinite(limit.max) && limit.min > limit.max) {
        const low = limit.max;
        limit.max = limit.min;
        limit.min = low;
      }
    }

    function snapshot() {
      return {
        position: { ...state.position },
        limits: JSON.parse(JSON.stringify(state.limits)),
        uncertain: state.uncertain,
        homed: state.homed
      };
    }

    return {
      get position() {
        return { ...state.position };
      },
      get limits() {
        return JSON.parse(JSON.stringify(state.limits));
      },
      get uncertain() {
        return state.uncertain;
      },
      get homed() {
        return state.homed;
      },
      limitFor,
      clampDelta,
      applyCommand,
      busyUntil,
      setHome,
      setAxisZero,
      setLimit,
      markUncertain() {
        state.uncertain = true;
      },
      snapshot
    };
  }

  // Moves (one per axis) that take the tracker from `from` to `to`, kept inside limits.
  function planMove(tracker, to) {
    const moves = [];
    for (const axis of AXES) {
      if (!to || !Number.isFinite(to[axis])) continue;
      const wanted = Math.round(to[axis] - tracker.position[axis]);
      const delta = tracker.clampDelta(axis, wanted);
      if (delta) moves.push({ axis, delta, clipped: delta !== wanted });
    }
    return moves;
  }

  // ------------------------------------------------------------------ image <-> steps
  // calibration: { panStepsPerFrame, risingStepsPerFrame } = signed steps that move the
  // scene by one full frame width / height (sign from the 2-click calibration).
  const DEFAULT_CALIBRATION = { panStepsPerFrame: 400, risingStepsPerFrame: -300 };

  // Point (u,v) in 0..1 frame coordinates -> steps that bring it to the frame centre.
  function stepsToCenter(u, v, calibration) {
    const cal = Object.assign({}, DEFAULT_CALIBRATION, calibration || {});
    return {
      pan: Math.round((u - 0.5) * cal.panStepsPerFrame) || 0,
      rising: Math.round((v - 0.5) * cal.risingStepsPerFrame) || 0
    };
  }

  // Two clicks on the same object before and after moving `steps` on one axis.
  // Pan forward moved the object from u1 to u2: moving the view by (u1 - u2) frames took
  // `steps`, so steps per frame = steps / (u1 - u2) (sign included).
  function calibrateAxis(before, after, steps) {
    const shift = before - after;
    if (!(Math.abs(shift) >= 0.02)) throw new Error('The object hardly moved. Use more steps and click the same object again.');
    return Math.round(steps / shift);
  }

  // Digital zoom viewport -> frame coordinates. zoom >= 1, (cx, cy) = viewport centre.
  function viewToFrame(x, y, zoom, cx, cy) {
    const z = Math.max(1, zoom || 1);
    return {
      u: clamp(cx + (x - 0.5) / z, 0, 1),
      v: clamp(cy + (y - 0.5) / z, 0, 1)
    };
  }

  function clampViewCenter(cx, cy, zoom) {
    const half = 0.5 / Math.max(1, zoom || 1);
    return { cx: clamp(cx, half, 1 - half), cy: clamp(cy, half, 1 - half) };
  }

  // ------------------------------------------------------------------ motion detection

  function toGray(rgba, out) {
    const pixels = rgba.length / 4;
    const gray = out && out.length === pixels ? out : new Uint8ClampedArray(pixels);
    for (let i = 0, j = 0; i < pixels; i += 1, j += 4) {
      gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    }
    return gray;
  }

  // zones: [{x,y,w,h}] in 0..1. No zones = the whole picture.
  function buildZoneMask(zones, width, height) {
    const mask = new Uint8Array(width * height);
    const list = Array.isArray(zones) ? zones.filter(zone => zone && zone.w > 0 && zone.h > 0) : [];
    if (!list.length) {
      mask.fill(1);
      return mask;
    }
    for (const zone of list) {
      const x0 = clamp(Math.floor(zone.x * width), 0, width);
      const y0 = clamp(Math.floor(zone.y * height), 0, height);
      const x1 = clamp(Math.ceil((zone.x + zone.w) * width), 0, width);
      const y1 = clamp(Math.ceil((zone.y + zone.h) * height), 0, height);
      for (let y = y0; y < y1; y += 1) mask.fill(1, y * width + x0, y * width + x1);
    }
    return mask;
  }

  // Sensitivity 1..100 -> per-pixel change threshold and minimum changed area.
  function sensitivityToThresholds(sensitivity) {
    const s = clamp(Number(sensitivity) || 50, 1, 100) / 100;
    return {
      pixelDelta: Math.round(60 - s * 45),          // 59 .. 15 grey levels
      minFraction: Number((0.03 - s * 0.027).toFixed(4)) // 3 % .. 0.3 % of the zone area
    };
  }

  function detectMotion(previous, current, width, height, mask, thresholds) {
    let changed = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const limit = thresholds.pixelDelta;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (!mask[i]) continue;
        area += 1;
        if (Math.abs(current[i] - previous[i]) > limit) {
          changed += 1;
          sumX += x;
          sumY += y;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const fraction = area ? changed / area : 0;
    const motion = changed > 0 && fraction >= thresholds.minFraction;
    return {
      motion,
      fraction,
      changed,
      centroid: changed ? { u: (sumX / changed + 0.5) / width, v: (sumY / changed + 0.5) / height } : null,
      box: changed ? { x: minX / width, y: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height } : null
    };
  }

  // ------------------------------------------------------------------ auto tracking
  // Move only when the moving object is outside the dead band around the centre; move a
  // fraction (gain) of the way to avoid overshoot with an estimated calibration.
  function trackingMove(centroid, options) {
    if (!centroid) return null;
    const deadband = (options && options.deadband) || 0.12;
    const gain = (options && options.gain) || 0.7;
    const du = centroid.u - 0.5;
    const dv = centroid.v - 0.5;
    if (Math.abs(du) < deadband && Math.abs(dv) < deadband) return null;
    const steps = stepsToCenter(centroid.u, centroid.v, options && options.calibration);
    return {
      pan: Math.abs(du) >= deadband ? Math.round(steps.pan * gain) : 0,
      rising: Math.abs(dv) >= deadband ? Math.round(steps.rising * gain) : 0
    };
  }

  // ------------------------------------------------------------------ device replies

  // "#INFO#0:123#END#" -> { code: 0, value: "123", number: 123 }
  function parseInfo(text) {
    const match = /#INFO#(-?\d+)(?::([^#]*))?#END#/.exec(String(text || ''));
    if (!match) return null;
    const value = (match[2] || '').trim();
    const numberMatch = /-?\d+(?:\.\d+)?/.exec(value);
    return { code: Number(match[1]), value, number: numberMatch ? Number(numberMatch[0]) : null };
  }

  // Ambient light -> night / day with hysteresis. Returns the new mode or null (keep).
  function nightModeDecision(lux, currentMode, thresholds) {
    if (!Number.isFinite(lux)) return null;
    const darkBelow = Number(thresholds && thresholds.darkBelow);
    const brightAbove = Number(thresholds && thresholds.brightAbove);
    if (lux <= darkBelow && currentMode !== 'night') return 'night';
    if (lux >= brightAbove && currentMode !== 'day') return 'day';
    return null;
  }

  // "HH:MM" window, may cross midnight. Empty window = always.
  function isWithinSchedule(date, start, end) {
    const parse = value => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const from = parse(start);
    const to = parse(end);
    if (from === null || to === null || from === to) return true;
    const minutes = date.getHours() * 60 + date.getMinutes();
    return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  }

  return Object.freeze({
    AXES,
    SPEED_RANGE,
    DEFAULT_TIMING,
    DEFAULT_CALIBRATION,
    parseMotorCommand,
    isStopCommand,
    motorCommand,
    msPerStep,
    estimateMoveMs,
    timingFromMeasurement,
    createTracker,
    planMove,
    stepsToCenter,
    calibrateAxis,
    viewToFrame,
    clampViewCenter,
    toGray,
    buildZoneMask,
    sensitivityToThresholds,
    detectMotion,
    trackingMove,
    parseInfo,
    nightModeDecision,
    isWithinSchedule
  });
});
