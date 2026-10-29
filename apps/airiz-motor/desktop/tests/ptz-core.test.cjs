'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../web/ptz-core.js');

test('motor commands are parsed, built and clamped to the firmware ranges', () => {
  assert.deepEqual(core.parseMotorCommand('diag motor pan forward 2 120'),
    { axis: 'pan', direction: 1, speed: 2, steps: 120, delta: 120 });
  assert.deepEqual(core.parseMotorCommand('  DIAG motor rising reverse 3 950 '),
    { axis: 'rising', direction: -1, speed: 3, steps: 950, delta: -950 });
  assert.equal(core.parseMotorCommand('diag motor pan forward 2'), null);
  assert.equal(core.parseMotorCommand('diag ver sw'), null);
  assert.equal(core.motorCommand('pan', 37, 2), 'diag motor pan forward 2 37');
  assert.equal(core.motorCommand('rising', -12.4, 99), 'diag motor rising reverse 30 12');
  assert.equal(core.motorCommand('pan', 0, 2), null);
  assert.throws(() => core.motorCommand('tilt', 5, 2));
  assert.throws(() => core.motorCommand('pan', 100000, 2));
  assert.ok(core.isStopCommand('echo 0 > /sys/devices/platform/soc/soc:motor/status'));
  assert.ok(core.isStopCommand('stop'));
  assert.ok(core.isStopCommand('diag motor stop'));
  assert.ok(!core.isStopCommand('diag motor pan forward 2 1'));
});

test('tracker sums every sent move, respects soft limits and re-homes', () => {
  const tracker = core.createTracker();
  tracker.applyCommand('diag motor pan forward 2 100', 0);
  tracker.applyCommand('diag motor pan reverse 2 30', 100000);
  tracker.applyCommand('diag motor rising forward 3 950', 200000);
  assert.deepEqual(tracker.position, { pan: 70, rising: 950 });
  tracker.setLimit('pan', 'min', -200);
  tracker.setLimit('pan', 'max', 150);
  assert.equal(tracker.clampDelta('pan', 500), 80);
  assert.equal(tracker.clampDelta('pan', -1000), -270);
  tracker.setHome();
  assert.deepEqual(tracker.position, { pan: 0, rising: 0 });
  assert.equal(tracker.uncertain, false);
  // limits swap when entered the wrong way round
  tracker.setLimit('rising', 'min', 500);
  tracker.setLimit('rising', 'max', -20);
  assert.deepEqual(tracker.limits.rising, { min: -20, max: 500 });
  const restored = core.createTracker(tracker.snapshot());
  assert.deepEqual(restored.limits, tracker.limits);
});

test('a stop during a move keeps only the part that ran and marks the position estimated', () => {
  const timing = { pan: 40 }; // 40 / speed 2 = 20 ms per step
  const tracker = core.createTracker();
  tracker.applyCommand('diag motor pan forward 2 400', 1000, timing); // 8000 ms planned
  assert.equal(tracker.busyUntil(), 9000);
  const result = tracker.applyCommand('echo 0 > /sys/devices/platform/soc/soc:motor/status', 4680, timing);
  assert.equal(result.type, 'stop');
  assert.deepEqual(result.partial, { axis: 'pan', planned: 400, done: 184 });
  assert.equal(tracker.position.pan, 184);
  assert.equal(tracker.uncertain, true);
  // a stop after the move finished changes nothing
  tracker.applyCommand('diag motor pan forward 2 10', 20000, timing);
  const late = tracker.applyCommand('stop', 30000, timing);
  assert.equal(late.partial, null);
  assert.equal(tracker.position.pan, 194);
});

test('presets are reached with clipped moves inside the limits', () => {
  const tracker = core.createTracker();
  tracker.setLimit('pan', 'min', -300);
  tracker.setLimit('pan', 'max', 300);
  tracker.applyCommand('diag motor pan forward 2 50', 0);
  assert.deepEqual(core.planMove(tracker, { pan: -120, rising: 40 }), [
    { axis: 'pan', delta: -170, clipped: false },
    { axis: 'rising', delta: 40, clipped: false }
  ]);
  assert.deepEqual(core.planMove(tracker, { pan: 900 }), [{ axis: 'pan', delta: 250, clipped: true }]);
  assert.deepEqual(core.planMove(tracker, { pan: 50, rising: 0 }), []);
});

test('click-to-center, calibration and digital zoom maths', () => {
  const cal = { panStepsPerFrame: 400, risingStepsPerFrame: -300 };
  assert.deepEqual(core.stepsToCenter(0.75, 0.5, cal), { pan: 100, rising: 0 });
  assert.deepEqual(core.stepsToCenter(0.5, 0.0, cal), { pan: 0, rising: 150 });
  // pan forward 100 steps moved the object from u=0.70 to u=0.45: 0.25 frame per 100 steps
  assert.equal(core.calibrateAxis(0.70, 0.45, 100), 400);
  assert.equal(core.calibrateAxis(0.30, 0.55, 100), -400);
  assert.throws(() => core.calibrateAxis(0.5, 0.505, 100));
  assert.deepEqual(core.viewToFrame(0.5, 0.5, 2, 0.5, 0.5), { u: 0.5, v: 0.5 });
  assert.deepEqual(core.viewToFrame(1, 0, 2, 0.5, 0.5), { u: 0.75, v: 0.25 });
  assert.deepEqual(core.clampViewCenter(0.95, 0.1, 2), { cx: 0.75, cy: 0.25 });
  assert.equal(Math.round(core.timingFromMeasurement(950, 3, 3800)), 12);
  assert.equal(core.estimateMoveMs('rising', 950, 3, { rising: 12 }), 3800);
});

function frame(width, height, fill) {
  return new Uint8ClampedArray(width * height).fill(fill);
}

test('motion detection finds the moving block, honours zones and sensitivity', () => {
  const width = 40;
  const height = 30;
  const before = frame(width, height, 40);
  const after = frame(width, height, 40);
  for (let y = 4; y < 10; y += 1) {
    for (let x = 28; x < 36; x += 1) after[y * width + x] = 200; // block top-right
  }
  const thresholds = core.sensitivityToThresholds(60);
  const everywhere = core.detectMotion(before, after, width, height, core.buildZoneMask([], width, height), thresholds);
  assert.equal(everywhere.motion, true);
  assert.equal(everywhere.changed, 48);
  assert.ok(everywhere.centroid.u > 0.75 && everywhere.centroid.v < 0.3, JSON.stringify(everywhere.centroid));
  // zone on the left half only: the block is ignored
  const leftZone = core.buildZoneMask([{ x: 0, y: 0, w: 0.5, h: 1 }], width, height);
  assert.equal(core.detectMotion(before, after, width, height, leftZone, thresholds).motion, false);
  // tiny change: detected at high sensitivity, ignored at low
  const speck = frame(width, height, 40);
  speck[5] = 200;
  speck[6] = 200;
  speck[7] = 200;
  speck[8] = 200; // 4 of 1200 pixels = 0.33 %, just above the most sensitive floor (0.3 %)
  const mask = core.buildZoneMask(null, width, height);
  assert.equal(core.detectMotion(before, speck, width, height, mask, core.sensitivityToThresholds(100)).motion, true);
  assert.equal(core.detectMotion(before, speck, width, height, mask, core.sensitivityToThresholds(10)).motion, false);
  // grey conversion
  assert.deepEqual([...core.toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))], [255, 0]);
});

test('auto-tracking moves only outside the dead band and toward the object', () => {
  const options = { deadband: 0.1, gain: 0.5, calibration: { panStepsPerFrame: 400, risingStepsPerFrame: -300 } };
  assert.equal(core.trackingMove({ u: 0.55, v: 0.45 }, options), null);
  assert.deepEqual(core.trackingMove({ u: 0.9, v: 0.5 }, options), { pan: 80, rising: 0 });
  assert.deepEqual(core.trackingMove({ u: 0.5, v: 0.1 }, options), { pan: 0, rising: 60 });
  assert.equal(core.trackingMove(null, options), null);
});

test('device replies, automatic night mode and schedules', () => {
  assert.deepEqual(core.parseInfo('~ #\r\n#INFO#0:123.5#END#\r\n'), { code: 0, value: '123.5', number: 123.5 });
  assert.deepEqual(core.parseInfo('#INFO#0:1#END#'), { code: 0, value: '1', number: 1 });
  assert.equal(core.parseInfo('no reply'), null);
  const thresholds = { darkBelow: 10, brightAbove: 40 };
  assert.equal(core.nightModeDecision(5, 'day', thresholds), 'night');
  assert.equal(core.nightModeDecision(25, 'night', thresholds), null); // hysteresis band
  assert.equal(core.nightModeDecision(60, 'night', thresholds), 'day');
  assert.equal(core.nightModeDecision(5, 'night', thresholds), null);
  assert.equal(core.nightModeDecision(NaN, 'day', thresholds), null);
  const at = (h, m) => new Date(2026, 9, 28, h, m);
  assert.equal(core.isWithinSchedule(at(23, 0), '22:00', '06:00'), true);
  assert.equal(core.isWithinSchedule(at(5, 59), '22:00', '06:00'), true);
  assert.equal(core.isWithinSchedule(at(12, 0), '22:00', '06:00'), false);
  assert.equal(core.isWithinSchedule(at(12, 0), '09:00', '18:00'), true);
  assert.equal(core.isWithinSchedule(at(12, 0), '', ''), true);
});


test('rising follows the real end stops once the bottom switch was seen', () => {
  const tracker = core.createTracker();
  const timing = { pan: 40, rising: 12 };
  // Not referenced yet: a move is only counted.
  tracker.applyCommand('diag motor rising reverse 3 300', 0, timing);
  assert.equal(tracker.position.rising, -300);
  assert.equal(tracker.risingRef, false);
  // Switch pressed: this is fully down.
  assert.equal(tracker.setRisingReference(), -300);
  assert.deepEqual(tracker.position, { pan: 0, rising: 0 });
  assert.equal(tracker.risingRef, true);
  // 2000 steps up from the bottom: the real camera stops at the top (1100).
  const up = tracker.applyCommand('diag motor rising forward 3 2000', 10000, timing);
  assert.equal(up.saturated, true);
  assert.equal(up.to, 1100);
  assert.equal(tracker.position.rising, 1100);
  // Down 550 = halfway, then 5000 down = back on the bottom switch.
  tracker.applyCommand('diag motor rising reverse 3 550', 100000, timing);
  assert.equal(tracker.position.rising, 550);
  tracker.applyCommand('diag motor rising reverse 3 5000', 200000, timing);
  assert.equal(tracker.position.rising, 0);
  // Moves planned by the console never ask for more than the travel.
  assert.equal(tracker.clampDelta('rising', 99999), 1100);
  assert.equal(tracker.clampDelta('rising', -50), 0);
});

test('live position moves linearly during a move and stops early at an end stop', () => {
  const tracker = core.createTracker({ risingRef: true, position: { pan: 0, rising: 900 } });
  const timing = { pan: 40, rising: 12 };
  // 400 steps up at speed 3: 1600 ms planned; the top (1100) is reached after 200 steps = 800 ms.
  tracker.applyCommand('diag motor rising forward 3 400', 1000, timing);
  assert.equal(tracker.livePosition(1000).rising, 900);
  assert.equal(tracker.livePosition(1400).rising, 1000);
  assert.equal(tracker.livePosition(1800).rising, 1100);
  assert.equal(tracker.livePosition(2500).rising, 1100);
  // Pan 4800 steps at speed 2 (20 ms/step = 96 s): halfway after 48 s.
  tracker.applyCommand('diag motor pan forward 2 4800', 10000, timing);
  assert.equal(tracker.livePosition(10000 + 48000).pan, 2400);
  // A stop part-way keeps the estimated position, clamped to the travel.
  const stop = tracker.applyCommand('echo 0 > /sys/devices/platform/soc/soc:motor/status', 10000 + 24000);
  assert.equal(stop.partial.done, 1200);
  assert.equal(tracker.position.pan, 1200);
});

test('home keeps the real height when the rising reference is known', () => {
  const tracker = core.createTracker({ risingRef: true, position: { pan: 700, rising: 550 } });
  tracker.setHome();
  assert.deepEqual(tracker.position, { pan: 0, rising: 550 });
  assert.deepEqual(tracker.home, { pan: 0, rising: 550 });
  // Seeing the bottom switch 30 steps lower than expected corrects position and home together.
  tracker.applyCommand('diag motor rising reverse 3 520', 0, { rising: 12 });
  assert.equal(tracker.position.rising, 30);
  assert.equal(tracker.setRisingReference(), 30);
  assert.deepEqual(tracker.home, { pan: 0, rising: 520 });
  const legacy = core.createTracker({ position: { pan: 5, rising: 40 } });
  legacy.setHome();
  assert.deepEqual(legacy.position, { pan: 0, rising: 0 });
});

test('switch replies and pose descriptions', () => {
  const info = text => core.parseInfo(text);
  assert.equal(core.parseSwitchState(info('#INFO#0:Pressed#END#')), true);
  assert.equal(core.parseSwitchState(info('#INFO#0:Released#END#')), false);
  assert.equal(core.parseSwitchState(info('#INFO#0:1#END#'), 1), true);
  assert.equal(core.parseSwitchState(info('#INFO#0:0#END#'), 1), false);
  assert.equal(core.parseSwitchState(info('#INFO#0:0#END#'), 0), true);
  assert.equal(core.parseSwitchState(info('#INFO#0:busy#END#')), null);
  assert.equal(core.parseSwitchState(null), null);

  const travel = { risingMax: 1100, panPerTurn: 4800 };
  const pose = (rising, pan, risingRef = true) => core.describePose({ rising, pan }, { travel, risingRef });
  assert.equal(pose(0, 0).heightLabel, 'Fully down');
  assert.equal(pose(1100, 0).heightLabel, 'Fully up');
  assert.equal(pose(550, 0).heightLabel, 'Halfway up');
  assert.equal(pose(275, 0).heightLabel, '25% up');
  assert.equal(pose(550, 0, false).heightLabel, 'Height unknown');
  assert.equal(pose(550, 0, false).heightFraction, null);
  assert.equal(pose(0, 1200).panLabel, '90\u00b0 counter-clockwise');
  assert.equal(pose(0, -2400).panLabel, '180\u00b0 clockwise');
  assert.equal(pose(0, 8).panLabel, 'Facing home');
  assert.equal(pose(0, 9600).panTurns, 2);
  assert.deepEqual(core.normalizeTravel({ risingMax: '1070', panPerTurn: -1 }), { risingMax: 1070, panPerTurn: 4800 });
});

test('the cable console shares its camera: a controller adopts position, Home, limits and the running move', () => {
  const timing = { pan: 40, rising: 12 };
  // The PC (holds the cable): home set, then the PC itself and a phone moved the camera.
  const pc = core.createTracker({ risingRef: true, position: { pan: 0, rising: 400 } });
  pc.setHome();
  pc.setLimit('pan', 'min', -900);
  pc.applyCommand('diag motor pan forward 2 100', 1000, timing);   // 2000 ms
  pc.applyCommand('diag motor rising forward 3 120', 3500, timing); // 480 ms, still running at 3700
  const shared = JSON.parse(JSON.stringify(pc.exportShared(3700)));
  assert.deepEqual(shared.position, { pan: 100, rising: 520 });
  assert.deepEqual(shared.pending, { axis: 'rising', from: 400, rawDelta: 120, expectedMs: 480, remainingMs: 280 });
  assert.deepEqual(shared.limits, { pan: { min: -900, max: null }, rising: { min: null, max: null } });

  // The phone only knew its own rising move; its clock is 50 s behind the PC's.
  const phone = core.createTracker();
  phone.applyCommand('diag motor rising forward 3 120', -46500, timing);
  assert.equal(phone.adoptShared(shared, -46300), true);
  assert.deepEqual(phone.position, { pan: 100, rising: 520 });
  assert.deepEqual(phone.home, { pan: 0, rising: 400 });
  assert.equal(phone.homed, true);
  assert.equal(phone.risingRef, true);
  assert.deepEqual(phone.limits, shared.limits);
  // The move still runs for 280 ms on the phone's own clock.
  assert.equal(phone.busyUntil(), -46300 + 280);
  // Go home from the phone now plans both axes from the real position.
  assert.deepEqual(core.planMove(phone, phone.home), [
    { axis: 'pan', delta: -100, clipped: false },
    { axis: 'rising', delta: -120, clipped: false }
  ]);

  // A finished move is not sent as running; broken states are refused and change nothing.
  assert.equal(pc.exportShared(10000).pending, null);
  assert.equal(phone.adoptShared(null, 0), false);
  assert.equal(phone.adoptShared({ position: { pan: 'x', rising: 1 } }, 0), false);
  assert.deepEqual(phone.position, { pan: 100, rising: 520 });
  // Missing limits and travel fall back to none / the defaults.
  const bare = core.createTracker();
  assert.equal(bare.adoptShared({ position: { pan: 5, rising: 6 } }, 0), true);
  assert.deepEqual(bare.limits, { pan: { min: null, max: null }, rising: { min: null, max: null } });
  assert.deepEqual(bare.travel, core.DEFAULT_TRAVEL);
  assert.equal(bare.busyUntil(), 0);
});

test('auto-tracking returns after the quiet time, also without new frames (window hidden)', () => {
  const base = { trackedAway: true, armed: true, track: true, lastMotionAt: 1000, waitMs: 30000, busyUntil: 0 };
  assert.equal(core.trackingReturnDue({ ...base, now: 30999 }), false);
  assert.equal(core.trackingReturnDue({ ...base, now: 31000 }), true);
  assert.equal(core.trackingReturnDue({ ...base, now: 31000, busyUntil: 32000 }), false);
  assert.equal(core.trackingReturnDue({ ...base, now: 999999, trackedAway: false }), false);
  assert.equal(core.trackingReturnDue({ ...base, now: 999999, armed: false }), false);
  assert.equal(core.trackingReturnDue({ ...base, now: 999999, track: false }), false);
  // Never sooner than 5 s, whatever the setting.
  assert.equal(core.trackingReturnDue({ ...base, waitMs: 1000, now: 5999 }), false);
  assert.equal(core.trackingReturnDue({ ...base, waitMs: 1000, now: 6000 }), true);
});
