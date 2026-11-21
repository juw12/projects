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

test('firmware count: the real answer of "diag motor info" is read (AIRIZ firmware 0.0.0.3)', () => {
  // As captured from a real AIRIZ after "diag motor pan forward 17 500".
  const rule = '================================================\r\n';
  const answer = (status, pan, rising) => 'diag motor info\r\n' + rule
    + '[module] List all motor property.\r\n#.Motor\t\t: Pan\r\n#.Status\t: ' + status + '\r\n#.Direction \t: Forward\r\n' + rule
    + '#.Pan motor current step\t: ' + pan + '\r\n#.Rising motor current step\t: ' + rising + '\r\n'
    + '#.Pan motor current angle\t: 46\r\n#.Rising motor current angle\t: 0\r\n' + rule
    + '\r\n#INFO#0#END#\r\n~ # \r\n~ # \r\n';
  assert.deepEqual(core.parseMotorInfo(answer('Idle', 500, 0)), { pan: 500, rising: 0, busy: false });
  assert.deepEqual(core.parseMotorInfo(answer('Busy', 23, 0)), { pan: 23, rising: 0, busy: true });
  assert.deepEqual(core.parseMotorInfo(answer('Idle', -120, 950)), { pan: -120, rising: 950, busy: false });
  // Half an answer (the serial text comes in pieces) and other answers are not taken for it.
  const whole = answer('Idle', 500, 0);
  assert.equal(core.parseMotorInfo(whole.slice(0, whole.indexOf('Rising motor current step'))), null);
  const cut = answer('Idle', 500, 950);
  assert.equal(core.parseMotorInfo(cut.slice(0, cut.indexOf('Rising motor current step') + 30)), null,
    'a number that may still grow ("95" of 950) is not read');
  assert.equal(core.parseMotorInfo('#INFO#0:Not Pressed#END#'), null);
  assert.equal(core.parseMotorInfo('Help info:\r\n rising \t rising motor\r\n pan \t pan motor\r\n'), null);
  assert.equal(core.parseMotorInfo(''), null);
  // The same unit answers the bottom switch with "Not Pressed".
  assert.equal(core.parseSwitchState(core.parseInfo('#INFO#0:Not Pressed#END#')), false);
});

test('firmware count: agrees or differs with the steps sent, and ranks below a real sensor', () => {
  assert.equal(core.judgeFirmwareCount(500, 500), 'firmware');
  assert.equal(core.judgeFirmwareCount(-500, -500), 'firmware');
  assert.equal(core.judgeFirmwareCount(500, 0), 'firmware-differs');
  assert.equal(core.judgeFirmwareCount(500, 480), 'firmware-differs');
  assert.equal(core.judgeFirmwareCount(0, 40), 'firmware-differs');
  assert.equal(core.judgeFirmwareCount(0, 0), null);

  // No firmware verdict: the sensor state stays as it is.
  assert.equal(core.withFirmwareCount('counted', null), 'counted');
  // Counted only: the firmware count is the best there is.
  assert.equal(core.withFirmwareCount('counted', 'firmware'), 'firmware');
  assert.equal(core.withFirmwareCount('counted', 'firmware-differs'), 'firmware-differs');
  // A sensor that agrees stays, unless the firmware count differs.
  assert.equal(core.withFirmwareCount('switch-up', 'firmware'), 'switch-up');
  assert.equal(core.withFirmwareCount('ok', 'firmware'), 'ok');
  assert.equal(core.withFirmwareCount('switch-up', 'firmware-differs'), 'firmware-differs');
  // A sensor that disagrees, a move that is running and an unknown height come first.
  for (const state of ['conflict', 'none', 'differs', 'watching', 'moving', 'unknown']) {
    assert.equal(core.withFirmwareCount(state, 'firmware'), state, state);
    assert.equal(core.withFirmwareCount(state, 'firmware-differs'), state, state);
  }

  assert.equal(core.feedbackLevel('firmware'), 'ok');
  assert.equal(core.feedbackLevel('firmware-differs'), 'warn');
  assert.equal(core.feedbackSummary('counted', 'firmware'), 'READ BACK FROM FIRMWARE');
  assert.equal(core.feedbackSummary('firmware', 'counted'), 'READ BACK FROM FIRMWARE');
  assert.equal(core.feedbackSummary('switch-up', 'firmware'), 'HEIGHT CHECKED BY SWITCH');
  assert.equal(core.feedbackSummary('firmware', 'ok'), 'PAN CHECKED BY CAMERA');
  assert.equal(core.feedbackSummary('switch-up', 'firmware-differs'), 'FIRMWARE COUNT DIFFERS');
  assert.equal(core.feedbackSummary('conflict', 'firmware-differs'), 'SENSOR DISAGREES');
  assert.equal(core.feedbackSummary('counted', 'counted'), 'COUNTED, NO SENSOR YET');
});

test('firmware count: the page reads it after every move and the demo device answers like the firmware', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /id="ptz-feedback-firmware"/);
  const ptz = fs.readFileSync(path.join(WEB, 'ptz.js'), 'utf8');
  assert.match(ptz, /api\.sendCommand\('diag motor info', \{ quiet: true \}\)/);
  assert.match(ptz, /firmware\.sent\[axis\] \+= result\.move\.delta;/);
  assert.match(ptz, /Math\.max\(tracker\.busyUntil\(\) - Date\.now\(\) \+ 500, firmware\.supported === true \? FOLLOW_GRACE_MS : 0\)/);
  // A stop, an end stop and the search for the bottom switch are not compared.
  assert.match(ptz, /feedback\.firmware\.unsure\.pan = feedback\.firmware\.unsure\.rising = true;/);
  assert.match(ptz, /\(result\.saturated \|\| findingHome\)\) firmware\.unsure\.rising = true;/);
  // Reporting only: the counted position is never set from the firmware count.
  const check = ptz.slice(ptz.indexOf('async function checkFirmwareCount('), ptz.indexOf('function resetFirmwareCount('));
  assert.ok(check.length > 500);
  assert.doesNotMatch(check, /tracker\.(position|set|apply|reset)/);
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  assert.match(app, /\^diag\\s\+motor\\s\+info\$/);
  assert.match(app, /'#\.Pan motor current step\\t: ' \+ demoDevice\.count\.pan/);
  const commands = fs.readFileSync(path.join(WEB, 'data', 'commands.js'), 'utf8');
  assert.match(commands, /id: "motor-info", label: "Read motor position \(firmware count\)", cmd: "diag motor info"/);
  assert.match(commands, /id: "usb-get", label: "Read USB mode", cmd: "diag usbmode get"/);
});

test('following (1.11.33): a running move is timed again from the firmware step count', () => {
  // Real AIRIZ (firmware 0.0.0.3), "diag motor pan forward 17 100": Busy with 22 steps 0.86 s
  // after the command, Busy with 69 steps at 1.66 s, Idle with 100 steps at 2.47 s.
  const t0 = 1700000000000;
  const tracker = core.createTracker();
  tracker.applyCommand('diag motor pan forward 17 100', t0, core.DEFAULT_TIMING);
  // The time model alone: over after a quarter of a second, long before the real motor.
  assert.ok(tracker.busyUntil() - t0 < 300);
  assert.equal(tracker.livePosition(t0 + 860).pan, 100);

  // First reading: the picture goes to the 22 steps the firmware has run, and the move runs on.
  const first = tracker.followPending(t0 + 860, 22);
  assert.equal(first.readings, 1);
  assert.equal(tracker.livePosition(t0 + 860).pan, 22);
  assert.ok(tracker.busyUntil() > t0 + 1660);

  // Second reading: 47 steps in 0.8 s = 17 ms per step, the firmware's "period 17".
  const second = tracker.followPending(t0 + 1660, 69);
  assert.equal(second.readings, 2);
  assert.ok(Math.abs(second.msPerStep - 17.02) < 0.01, String(second.msPerStep));
  assert.equal(tracker.livePosition(t0 + 1660).pan, 69);
  assert.equal(tracker.livePosition(t0 + 1660 + 170).pan, 79);
  // The end: 31 more steps at 17 ms, about 2.19 s after the command (the unit was Idle at the 2.47 s look).
  assert.ok(Math.abs(tracker.busyUntil() - (t0 + 1660 + 31 * 17.02)) < 2);
  // Only the timing changed: the counted position is where the command put it.
  assert.equal(tracker.position.pan, 100);
  assert.equal(tracker.uncertain, false);

  // Readings that say nothing are left out: not started, no progress, all done, another size.
  const end = tracker.busyUntil();
  assert.equal(tracker.followPending(t0 + 1700, 0), null);
  assert.equal(tracker.followPending(t0 + 1700, 69), null);
  assert.equal(tracker.followPending(t0 + 1700, 100), null);
  assert.equal(tracker.followPending(t0 + 1700, 140), null);
  assert.equal(tracker.followPending(t0 + 1700, -5), null);
  assert.equal(tracker.busyUntil(), end);

  // A controller that takes the shared camera over gets the followed timing.
  const controller = core.createTracker();
  controller.adoptShared(tracker.exportShared(t0 + 1660), 5000);
  assert.equal(controller.livePosition(5000).pan, 69);
  assert.ok(Math.abs(controller.busyUntil() - 5000 - 31 * 17.02) < 2);

  // A stop now keeps the steps the firmware really ran, not what the short time model says.
  const stopped = core.createTracker();
  stopped.applyCommand('diag motor pan forward 17 500', t0, core.DEFAULT_TIMING);
  stopped.followPending(t0 + 860, 23);
  stopped.followPending(t0 + 1660, 70);
  const partial = stopped.applyCommand('stop', t0 + 1660 + 170, core.DEFAULT_TIMING).partial;
  assert.equal(partial.done, 80);
  assert.equal(stopped.position.pan, 80);

  // Nothing to follow without a running move.
  assert.equal(core.createTracker().followPending(t0, 10), null);
});

test('following (1.11.33): Idle with every step counted ends the move, and a learned step time is used', () => {
  const t0 = 1700000000000;
  // A time model that is too long (the user set a big timing number): the firmware is done first.
  const tracker = core.createTracker();
  tracker.applyCommand('diag motor pan forward 17 100', t0, { pan: 4000, rising: 12 });
  assert.ok(tracker.busyUntil() - t0 > 20000);
  assert.equal(tracker.finishPending(t0 + 2470), true);
  assert.equal(tracker.busyUntil(), t0 + 2470);
  assert.equal(tracker.livePosition(t0 + 2470).pan, 100);
  // A move that is over is not made longer, and there is nothing to finish without a move.
  assert.equal(tracker.finishPending(t0 + 9000), true);
  assert.equal(tracker.busyUntil(), t0 + 2470);
  assert.equal(core.createTracker().finishPending(t0), false);

  // The step time the firmware showed at X = 17 is used for X = 17 only.
  const timing = { pan: 40, rising: 12, measured: { pan: { 17: 17 } } };
  assert.equal(core.measuredStepMs('pan', 17, timing), 17);
  assert.equal(core.measuredStepMs('pan', 2, timing), null);
  assert.equal(core.measuredStepMs('rising', 17, timing), null);
  assert.equal(core.measuredStepMs('pan', 17, core.DEFAULT_TIMING), null);
  assert.equal(core.msPerStep('pan', 17, timing), 17);
  assert.equal(core.msPerStep('pan', 2, timing), 20);
  assert.equal(core.estimateMoveMs('pan', 500, 17, timing), 8500);
  assert.equal(core.msPerStep('pan', 17, core.DEFAULT_TIMING), 40 / 17);

  // With the step time known, the first reading already gives the right end: the half second
  // before the motor starts is not taken for slow steps.
  const known = core.createTracker();
  known.applyCommand('diag motor pan forward 17 500', t0, timing);
  assert.equal(known.busyUntil(), t0 + 8500);
  const fit = known.followPending(t0 + 860, 23, 17);
  assert.equal(fit.msPerStep, 17);
  assert.equal(known.livePosition(t0 + 860).pan, 23);
  assert.equal(known.busyUntil(), t0 + 860 + 477 * 17);
  // A known step time that cannot be right (slower than the time since the command allows) is not used.
  const slow = core.createTracker();
  slow.applyCommand('diag motor pan forward 17 500', t0, timing);
  assert.ok(Math.abs(slow.followPending(t0 + 860, 23, 300).msPerStep - 860 / 23) < 1e-9);
});

test('following (1.11.33): the page follows a move while the firmware says Busy and the demo device moves in time', () => {
  const ptz = fs.readFileSync(path.join(WEB, 'ptz.js'), 'utf8');
  // The move is followed only when the count before it is known.
  assert.match(ptz, /const followable = firmware\.supported === true && !!firmware\.last && !firmware\.unsure\[axis\] && !wasMoving/);
  assert.match(ptz, /scheduleFirmwareCheck\(followable\s+\? FOLLOW_FIRST_MS/);
  const check = ptz.slice(ptz.indexOf('async function checkFirmwareCount('), ptz.indexOf('function learnStepTime('));
  assert.match(check, /tracker\.followPending\(now, done, core\.measuredStepMs\(follow\.axis, follow\.speed, store\.timing\)\)/);
  assert.match(check, /if \(follow && info\[follow\.axis\] === follow\.target\) \{\s+\/\/[^\n]*\n\s+tracker\.finishPending\(now\);/);
  // An early Idle is not believed before the grace time is over.
  assert.match(check, /now < Math\.max\(tracker\.busyUntil\(\), firmware\.lastMoveAt \+ FOLLOW_GRACE_MS\)/);
  // A sequence of moves and the bottom switch wait for the followed end.
  assert.match(ptz, /async function waitIdle\(token\) \{\s+while \(Date\.now\(\) < motionEnd\(\)\)/);
  assert.match(ptz, /if \(Date\.now\(\) < motionEnd\(\)\) \{\s+scheduleBottomCheck\(motionEnd\(\) - Date\.now\(\) \+ 400\);/);
  // A stop ends the following.
  assert.match(ptz, /feedback\.firmware\.follow = null;\s+feedback\.firmware\.settleBy = 0;\s+scheduleFirmwareCheck\(900\);/);
  // The demo device: Busy with the steps done so far, a stop ends the move where it is.
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  assert.match(app, /\(demoDevice\.move \? 'Busy' : 'Idle'\)/);
  assert.match(app, /localStorage\.getItem\('airiz\.demo\.stepMs'\)/);
  assert.match(app, /function demoAdvance\(now\)/);
});

test('real unit (1.11.33): the step times seen on a real AIRIZ are known before the first move', () => {
  // Real AIRIZ, firmware 0.0.0.3: pan at X = 17 took 17.0 ms per step, rising at X = 30 took 30.0.
  const timing = core.defaultTiming();
  assert.equal(timing.pan, core.DEFAULT_TIMING.pan);
  assert.equal(timing.rising, core.DEFAULT_TIMING.rising);
  assert.equal(core.msPerStep('pan', 17, timing), 17);
  assert.equal(core.msPerStep('rising', 30, timing), 30);
  assert.equal(core.estimateMoveMs('rising', 1100, 30, timing), 33000);
  // Every other X stays on the model: it was not run on the real unit.
  assert.equal(core.msPerStep('pan', 2, timing), 20);
  assert.equal(core.msPerStep('rising', 3, timing), 4);
  // Each call gives its own copy.
  timing.measured.pan[17] = 99;
  assert.equal(core.msPerStep('pan', 17, core.defaultTiming()), 17);
  // An axis that was timed by hand keeps its own number.
  assert.deepEqual(core.seedStepTimes({ pan: 55, rising: 12 }), { rising: { 30: 30 } });
  assert.deepEqual(core.seedStepTimes({ pan: 40, rising: 12 }), { pan: { 17: 17 }, rising: { 30: 30 } });
  const ptz = fs.readFileSync(path.join(WEB, 'ptz.js'), 'utf8');
  assert.match(ptz, /timing: core\.defaultTiming\(\),/);
  assert.match(ptz, /if \(!\(stored\.timing && stored\.timing\.measured\)\) timing\.measured = core\.seedStepTimes\(timing\);/);
  assert.match(ptz, /store\.timing = core\.defaultTiming\(\);/);
});

test('real unit (1.11.33): finding the bottom never lowers much more than the full travel', () => {
  // On the real AIRIZ the bottom switch read "Not Pressed" at every height, so the search ran to
  // its cap: 1800 steps against the bottom stop. The cap is now the full travel plus a margin.
  assert.equal(core.findHomeLimit({ risingMax: 1100 }), 1200);
  assert.equal(core.findHomeLimit({ risingMax: 600 }), 700);
  assert.equal(core.findHomeLimit(null), 1200);
  const ptz = fs.readFileSync(path.join(WEB, 'ptz.js'), 'utf8');
  assert.equal((ptz.match(/findRisingHome\(([^,()]+\(\)|token), 60, core\.findHomeLimit\(tracker\.travel\), from\)/g) || []).length, 2);
  assert.doesNotMatch(ptz, /findRisingHome\([^\n]*1800/);
  assert.match(ptz, /more than the full travel\) and the bottom switch never read pressed/);
});

test('every sensor label and summary has a Traditional Chinese text', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'i18n', 'zh-TW.json'), 'utf8'));
  const labels = [
    ...Object.values(core.RISING_FEEDBACK_LABEL),
    ...Object.values(core.PAN_FEEDBACK_LABEL),
    'SENSOR CHECKED', 'HEIGHT CHECKED BY SWITCH', 'PAN CHECKED BY CAMERA', 'SENSOR DISAGREES', 'COUNTED, NO SENSOR YET',
    'POSITION FEEDBACK', 'Sensors', 'Height:', 'Pan:',
    'FIRMWARE COUNT DIFFERS', 'READ BACK FROM FIRMWARE', 'Firmware count:', 'not read'
  ];
  for (const label of labels) assert.ok(catalog.text[label], label);
});
