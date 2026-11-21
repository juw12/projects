'use strict';
// 1.11.30 position feedback: the motors have no encoder, so the counted position is checked by
// the bottom switch (height) and by the camera picture (pan). These are the rules and the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const WEB = path.join(__dirname, '..', '..', 'web');
const core = require(path.join(WEB, 'ptz-core.js'));
const device = require(path.join(WEB, 'device-3d.js'));

const WIDTH = 160;
const HEIGHT = 90;

// A detailed scene that can be sampled anywhere, so the camera can pan across it for any distance.
function scene(x, y) {
  return 128
    + 40 * Math.sin(x * 0.21 + 1.3) * Math.cos(y * 0.17)
    + 30 * Math.sin((x + 2 * y) * 0.093)
    + 25 * Math.cos((3 * x - y) * 0.051 + 0.7)
    + 20 * Math.sin(Math.hypot(x - 90, y - 70) * 0.31);
}

// Camera frame with the picture content moved right by `ox` pixels and down by `oy`.
function frame(ox, oy) {
  const gray = new Uint8ClampedArray(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) gray[y * WIDTH + x] = scene(x - ox, y - oy);
  }
  return { gray, width: WIDTH, height: HEIGHT };
}

// A picture that has nothing to do with the scene (the lens is covered by something busy).
function noise(seed) {
  const gray = new Uint8ClampedArray(WIDTH * HEIGHT);
  let state = seed;
  for (let i = 0; i < gray.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    gray[i] = state >>> 24;
  }
  return { gray, width: WIDTH, height: HEIGHT };
}

function flat(value) {
  return { gray: new Uint8ClampedArray(WIDTH * HEIGHT).fill(value), width: WIDTH, height: HEIGHT };
}

test('height: the bottom switch confirms, contradicts or says nothing about the counted height', () => {
  const state = (rising, reading, extra) => core.risingFeedback({ rising, risingRef: true, reading, ...extra });
  const pressed = { pressed: true, fresh: true };
  const open = { pressed: false, fresh: true };
  assert.equal(state(0, pressed), 'switch-down');
  assert.equal(state(600, open), 'switch-up');
  // Sent up but the switch is still pressed, or sent down and it is not: the sensor disagrees.
  assert.equal(state(600, pressed), 'conflict');
  assert.equal(state(0, open), 'conflict');
  // Just above the bottom the switch may still be pressed: no verdict there.
  assert.equal(state(core.SWITCH_CLEAR_STEPS, pressed), 'counted');
  assert.equal(state(core.SWITCH_CLEAR_STEPS + 1, pressed), 'conflict');
  // A reading from before the last move, or no reading: counted only.
  assert.equal(state(600, { pressed: false, fresh: false }), 'counted');
  assert.equal(state(600, null), 'counted');
  assert.equal(state(600, open, { moving: true }), 'moving');
  // Without the height reference "off the bottom" does not make the number right.
  assert.equal(core.risingFeedback({ rising: 600, risingRef: false, reading: open }), 'unknown');
  assert.equal(core.risingFeedback({ rising: 0, risingRef: false, reading: null }), 'unknown');
  // Just connected, the camera stands somewhere up: the count starts at 0 without a reference.
  // That is "height unknown", not a switch that disagrees.
  assert.equal(core.risingFeedback({ rising: 0, risingRef: false, reading: open }), 'unknown');
  assert.equal(core.risingFeedback({ rising: 0, risingRef: false, reading: pressed }), 'unknown');
});

test('the answer of another query is not taken for a switch state', () => {
  const info = text => core.parseInfo(text);
  // On connect the firmware version is asked at the same moment; the light sensor is polled too.
  assert.equal(core.parseSwitchState(info('#INFO#0:0.0.0.3#END#')), null);
  assert.equal(core.parseSwitchState(info('#INFO#0:120#END#')), null);
  assert.equal(core.parseSwitchState(info('#INFO#0:1.0#END#')), null);
  assert.equal(core.parseSwitchState(info('#INFO#0:Pressed#END#')), true);
  assert.equal(core.parseSwitchState(info('#INFO#0:Released#END#')), false);
  assert.equal(core.parseSwitchState(info('#INFO#0:1#END#'), 1), true);
  assert.equal(core.parseSwitchState(info('#INFO#0:0#END#'), 1), false);
  // The page waits for an answer that reads as a switch state.
  const ptz = fs.readFileSync(path.join(WEB, 'ptz.js'), 'utf8');
  assert.match(ptz, /function querySwitch\(background\)/);
  assert.match(ptz, /info => core\.parseSwitchState\(info, store\.switchPressedValue\) !== null/);
  assert.doesNotMatch(ptz, /await query\('diag button get rising-det'/);
});

test('pan: the odometer follows the picture over a turn much longer than one picture width', () => {
  const odometer = core.createOdometer(frame(0, 0));
  let travel = odometer.travelled();
  for (let i = 1; i <= 40; i += 1) travel = odometer.add(frame(6 * i, 0));
  // 240 px on a 160 px wide picture = 1.5 widths, measured in several hops.
  assert.equal(travel.lost, false);
  assert.ok(Math.abs(travel.dx - 1.5) < 0.03, `dx ${travel.dx}`);
  assert.ok(Math.abs(travel.dy) < 0.03, `dy ${travel.dy}`);
  assert.ok(travel.hops >= 8, `hops ${travel.hops}`);

  const back = core.createOdometer(frame(0, 0));
  for (let i = 1; i <= 20; i += 1) travel = back.add(frame(-5 * i, 0));
  assert.ok(Math.abs(travel.dx + 100 / WIDTH) < 0.03, `dx ${travel.dx}`);
});

test('pan: a short turn counts before the first hop, a still picture stays at zero', () => {
  const short = core.createOdometer(frame(0, 0));
  const travel = short.add(frame(8, 0));
  assert.equal(travel.hops, 0);
  assert.ok(Math.abs(travel.dx - 8 / WIDTH) < 0.01, `dx ${travel.dx}`);

  const still = core.createOdometer(frame(0, 0));
  let rest = still.travelled();
  for (let i = 0; i < 6; i += 1) rest = still.add(frame(0, 0));
  assert.deepEqual({ dx: rest.dx, dy: rest.dy, lost: rest.lost }, { dx: 0, dy: 0, lost: false });
});

test('pan: a plain wall, darkness or a picture that jumps away give no measurement', () => {
  assert.equal(core.createOdometer(flat(90)).travelled().lost, true);
  assert.equal(core.createOdometer(null).travelled().lost, true);

  const odometer = core.createOdometer(frame(0, 0));
  let travel = odometer.travelled();
  // The view is covered: the frames have nothing in common with the key frame any more.
  travel = odometer.add(noise(1));
  assert.equal(travel.lost, true, 'a frame without a match is never the last word');
  // One bad frame in between is forgiven, a row of them ends the measurement for good.
  travel = odometer.add(frame(4, 0));
  assert.equal(travel.lost, false);
  for (let i = 2; i <= 5; i += 1) travel = odometer.add(noise(i));
  assert.equal(odometer.add(frame(4, 0)).lost, true);
  // The watch on the page allows more blurred frames in a row.
  const patient = core.createOdometer(frame(0, 0), { maxMisses: 12 });
  for (let i = 2; i <= 9; i += 1) patient.add(noise(i));
  assert.equal(patient.add(frame(4, 0)).lost, false);
  // A frame of another size (the preview was restarted) ends the measurement too.
  const resized = core.createOdometer(frame(0, 0));
  assert.equal(resized.add({ gray: new Uint8ClampedArray(80 * 45), width: 80, height: 45 }).lost, true);
});

test('pan: what the camera saw is compared with the steps that were sent', () => {
  const perFrame = 400;
  // Pan forward moves the picture content the other way: steps = -travel x steps per picture width.
  assert.deepEqual(core.judgeTurn(400, -1, perFrame, true), { verdict: 'ok', measuredSteps: 400 });
  assert.deepEqual(core.judgeTurn(-800, 2.1, perFrame, true), { verdict: 'ok', measuredSteps: -840 });
  assert.equal(core.judgeTurn(400, -0.5, perFrame, true).verdict, 'differs');
  assert.equal(core.judgeTurn(400, 1, perFrame, true).verdict, 'differs'); // turned the wrong way
  assert.equal(core.judgeTurn(400, -0.02, perFrame, true).verdict, 'none');
  // The edges of "agrees": 70 % to 130 % of the turn.
  assert.equal(core.judgeTurn(1000, -0.7 * 1000 / perFrame, perFrame, true).verdict, 'ok');
  assert.equal(core.judgeTurn(1000, -1.3 * 1000 / perFrame, perFrame, true).verdict, 'ok');
  assert.equal(core.judgeTurn(1000, -1.4 * 1000 / perFrame, perFrame, true).verdict, 'differs');
  // Not calibrated: only "the picture moved" or "it did not", no amount.
  assert.deepEqual(core.judgeTurn(400, -0.4, perFrame, false), { verdict: 'moved', measuredSteps: null });
  assert.deepEqual(core.judgeTurn(400, 0.004, perFrame, false), { verdict: 'none', measuredSteps: null });
  // Too short to judge: under 40 steps, or under 8 % of a picture width.
  assert.equal(core.judgeTurn(30, 0, perFrame, true), null);
  assert.equal(core.judgeTurn(100, 0, 2000, true), null);
  assert.equal(core.judgeTurn(0, 0.5, perFrame, true), null);
});

test('the odometer and the comparison together: a simulated 90 degree turn is confirmed', () => {
  const perFrame = 400; // steps for one picture width
  const commanded = 1200; // 90 degrees at 4800 steps per turn
  const pixels = -commanded / perFrame * WIDTH; // content moves left for pan forward
  const odometer = core.createOdometer(frame(0, 0));
  let travel = odometer.travelled();
  for (let i = 1; i <= 60; i += 1) travel = odometer.add(frame(pixels * i / 60, 0));
  const verdict = core.judgeTurn(commanded, travel.dx, perFrame, true);
  assert.equal(verdict.verdict, 'ok');
  assert.ok(Math.abs(verdict.measuredSteps - commanded) < 40, `measured ${verdict.measuredSteps}`);

  // The motor stalled after a third of the turn: the camera reports it.
  const stalled = core.createOdometer(frame(0, 0));
  for (let i = 1; i <= 20; i += 1) travel = stalled.add(frame(pixels * i / 60, 0));
  for (let i = 0; i < 10; i += 1) travel = stalled.add(frame(pixels / 3, 0));
  assert.equal(core.judgeTurn(commanded, travel.dx, perFrame, true).verdict, 'differs');
});

test('the summary line and the levels', () => {
  assert.equal(core.feedbackSummary('switch-up', 'ok'), 'SENSOR CHECKED');
  assert.equal(core.feedbackSummary('switch-down', 'moved'), 'SENSOR CHECKED');
  assert.equal(core.feedbackSummary('switch-down', 'counted'), 'HEIGHT CHECKED BY SWITCH');
  assert.equal(core.feedbackSummary('counted', 'ok'), 'PAN CHECKED BY CAMERA');
  assert.equal(core.feedbackSummary('counted', 'counted'), 'COUNTED, NO SENSOR YET');
  assert.equal(core.feedbackSummary('moving', 'watching'), 'COUNTED, NO SENSOR YET');
  assert.equal(core.feedbackSummary('unknown', 'counted'), 'COUNTED, NO SENSOR YET');
  for (const [rising, pan] of [['conflict', 'ok'], ['switch-up', 'none'], ['switch-down', 'differs']]) {
    assert.equal(core.feedbackSummary(rising, pan), 'SENSOR DISAGREES');
  }
  assert.equal(core.feedbackLevel('switch-up'), 'ok');
  assert.equal(core.feedbackLevel('conflict'), 'warn');
  assert.equal(core.feedbackLevel('none'), 'warn');
  assert.equal(core.feedbackLevel('watching'), 'busy');
  assert.equal(core.feedbackLevel('counted'), 'none');
  assert.equal(core.feedbackLevel('unknown'), 'none');
});

test('3D unit: the tags beside the numbers', () => {
  const tags = device.feedbackTags({
    rising: { state: 'switch-up', label: 'off the bottom \u2713', level: 'ok' },
    pan: { state: 'none', label: 'camera saw no turn \u26a0', level: 'warn' },
    summary: 'SENSOR DISAGREES',
    level: 'warn'
  });
  assert.deepEqual(tags, {
    rise: { label: 'off the bottom \u2713', level: 'ok' },
    pan: { label: 'camera saw no turn \u26a0', level: 'warn' },
    summary: 'SENSOR DISAGREES',
    level: 'warn'
  });
  // No PTZ tracker (or an older one): counted, never a made-up confirmation.
  for (const missing of [null, undefined, {}, { rising: {} }]) {
    assert.deepEqual(device.feedbackTags(missing), {
      rise: { label: 'counted', level: 'none' },
      pan: { label: 'counted', level: 'none' },
      summary: 'COUNTED, NO SENSOR YET',
      level: 'none'
    });
  }
});

test('wiring: the page has the places for the sensor tags and the tracker offers the feedback', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  for (const id of ['device-3d-rise-source', 'device-3d-pan-source', 'device-3d-caption', 'device-3d-feedback',
    'ptz-feedback-rising', 'ptz-feedback-pan']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  const ptz = fs.readFileSync(path.join(WEB, 'ptz.js'), 'utf8');
  assert.match(ptz, /feedback: \(\) => feedbackState\(\)/);
  // The switch is read after every rising move and the camera watches every pan move.
  assert.match(ptz, /result\.move\.axis === 'rising'\) \{\s+feedback\.risingMoveEnd/);
  assert.match(ptz, /result\.move\.axis === 'pan'\) startPanWatch\(\)/);
  // The pose drawing reads the feedback from its first call on, so it has to exist before that.
  assert.ok(ptz.indexOf('const feedback = {') > 0);
  assert.ok(ptz.indexOf('const feedback = {') < ptz.indexOf('function renderPose('));
  // The feedback caption replaces the "not position feedback" line once the readout script runs,
  // on the 3D unit and on the drawn picture.
  const css = fs.readFileSync(path.join(WEB, 'console-ui.css'), 'utf8');
  assert.match(css, /\.motion-stage\.has-feedback \.stage-caption:not\(\.device-3d-caption\) \{ display: none; \}/);
  assert.match(css, /\.device-3d-caption \{ display: none; \}/);
});

test('every sensor label and summary has a Traditional Chinese text', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'i18n', 'zh-TW.json'), 'utf8'));
  const labels = [
    ...Object.values(core.RISING_FEEDBACK_LABEL),
    ...Object.values(core.PAN_FEEDBACK_LABEL),
    'SENSOR CHECKED', 'HEIGHT CHECKED BY SWITCH', 'PAN CHECKED BY CAMERA', 'SENSOR DISAGREES', 'COUNTED, NO SENSOR YET',
    'POSITION FEEDBACK', 'Sensors', 'Height:', 'Pan:'
  ];
  for (const label of labels) assert.ok(catalog.text[label], label);
});
