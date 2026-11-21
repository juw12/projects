'use strict';
// Home page 3D unit: counted steps -> rise / pan of the model, the X-ray and Opaque views, and the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const WEB = path.join(__dirname, '..', '..', 'web');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const device = require(path.join(WEB, 'device-3d.js'));

const META = { strokeMm: 30, leadMm: 1, pinion: { axis: [-28.87, 7.675], ratio: 6.72 } };
const TRAVEL = { risingMax: 1100, panPerTurn: 4800 };
const TAU = Math.PI * 2;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-4, `${message || 'value'}: ${actual} is not ${expected}`);
}

// Column-major 4x4 times a point.
function move(matrix, point) {
  return [0, 1, 2].map((row) => matrix[row] * point[0] + matrix[4 + row] * point[1] + matrix[8 + row] * point[2] + matrix[12 + row]);
}

test('rising steps become millimetres of lift', () => {
  near(device.mechanism({ pan: 0, rising: 0 }, TRAVEL, META).liftMm, 0);
  near(device.mechanism({ pan: 0, rising: 550 }, TRAVEL, META).liftMm, 15);
  const up = device.mechanism({ pan: 0, rising: 1100 }, TRAVEL, META);
  near(up.liftMm, 30);
  near(up.fraction, 1);
  // The lead screw turns once per lead: 30 mm / 1 mm = 30 turns.
  near(up.screwRad / TAU, 30);
});

test('the lift never leaves the stroke', () => {
  near(device.mechanism({ pan: 0, rising: 5000 }, TRAVEL, META).liftMm, 30);
  near(device.mechanism({ pan: 0, rising: -200 }, TRAVEL, META).liftMm, 0);
});

test('pan steps become degrees, forward is positive', () => {
  near(device.mechanism({ pan: 1200, rising: 0 }, TRAVEL, META).panDegrees, 90);
  near(device.mechanism({ pan: -2400, rising: 0 }, TRAVEL, META).panDegrees, -180);
  near(device.mechanism({ pan: 4800, rising: 0 }, TRAVEL, META).panDegrees, 360);
});

test('the pinion spins the other way, faster by the gear ratio', () => {
  const moved = device.mechanism({ pan: 1200, rising: 0 }, TRAVEL, META);
  near(moved.pinionRad, -6.72 * moved.panRad);
  assert.ok(moved.pinionRad < 0);
});

test('the travel settings of the PTZ page are used, with defaults when they are missing', () => {
  near(device.mechanism({ pan: 1000, rising: 1000 }, { risingMax: 2000, panPerTurn: 4000 }, META).liftMm, 15);
  near(device.mechanism({ pan: 1000, rising: 1000 }, { risingMax: 2000, panPerTurn: 4000 }, META).panDegrees, 90);
  near(device.mechanism({ pan: 1200, rising: 1100 }, null, META).liftMm, 30);
  near(device.mechanism({ pan: 1200, rising: 1100 }, { risingMax: 0, panPerTurn: 'x' }, META).panDegrees, 90);
  near(device.mechanism(null, TRAVEL, META).liftMm, 0);
});

test('turning: a quarter turn forward swings the lens, the axis stays put, the lift is added', () => {
  const lens = move(device.turnLift(Math.PI / 2, 0, 0, 0), [0, 0, -1]);
  near(lens[0], -1, 'lens x');
  near(lens[1], 0, 'lens y');
  near(lens[2], 0, 'lens z');

  const pivot = move(device.turnLift(1.234, -28.87, 7.675, 12), [-28.87, 5, 7.675]);
  near(pivot[0], -28.87, 'pivot x');
  near(pivot[1], 17, 'pivot y');
  near(pivot[2], 7.675, 'pivot z');
});

test('each group of parts moves as on the unit', () => {
  const moved = device.mechanism({ pan: 1200, rising: 550 }, TRAVEL, META);
  const point = [10, 0, -20];
  // Base: fixed. Carriage: lifts only. Head: lifts and pans. Screw: turns in place.
  assert.deepEqual(move(device.groupMatrix('base', moved, META), point), point);
  assert.deepEqual(move(device.groupMatrix('carriage', moved, META), point), [10, 15, -20]);
  const head = move(device.groupMatrix('head', moved, META), point);
  near(head[0], -20, 'head x');
  near(head[1], 15, 'head y');
  near(head[2], -10, 'head z');
  near(move(device.groupMatrix('screw', moved, META), point)[1], 0, 'screw stays at its height');
  // The pinion rides on the carriage and turns about its own shaft.
  const shaft = move(device.groupMatrix('pinion', moved, META), [-28.87, 0, 7.675]);
  near(shaft[0], -28.87, 'pinion shaft x');
  near(shaft[1], 15, 'pinion shaft y');
  near(shaft[2], 7.675, 'pinion shaft z');
  // The floor arrow shows the pan direction and stays on the floor.
  near(move(device.groupMatrix('pointer', moved, META), point)[1], 0, 'arrow stays on the floor');
});

test('X-ray hides the fabric and makes the shells see-through, the mechanism stays solid', () => {
  assert.equal(device.partStyle('fabric', 'xray'), null);
  for (const shell of ['housing', 'head', 'speaker', 'other']) {
    const style = device.partStyle(shell, 'xray');
    assert.equal(style.edge, true, shell);
    assert.ok(style.alpha < 1, shell);
  }
  for (const part of ['screw', 'nut', 'motor', 'gear', 'panGear', 'camera', 'pcb']) {
    const style = device.partStyle(part, 'xray');
    assert.equal(style.edge, false, part);
    assert.equal(style.alpha, 1, part);
  }
});

test('Opaque draws every part solid, the fabric included', () => {
  for (const part of ['fabric', 'housing', 'head', 'speaker', 'other', 'screw', 'camera', 'unknown-part']) {
    const style = device.partStyle(part, 'opaque');
    assert.equal(style.alpha, 1, part);
    assert.equal(style.edge, false, part);
    assert.equal(style.color.length, 3, part);
    assert.ok(style.color.every((channel) => channel >= 0 && channel <= 1), part);
  }
});

test('readout: millimetres and degrees with the turn direction seen from above', () => {
  const text = (pan, rising) => device.readout(device.mechanism({ pan, rising }, TRAVEL, META));
  assert.deepEqual(text(0, 0), { rise: '0.0 mm', pan: '0\u00b0' });
  assert.deepEqual(text(1200, 1100), { rise: '30.0 mm', pan: '90\u00b0 \u21ba' });
  assert.deepEqual(text(-1200, 550), { rise: '15.0 mm', pan: '90\u00b0 \u21bb' });
  assert.deepEqual(text(4800, 0), { rise: '0.0 mm', pan: '0\u00b0' });
  assert.deepEqual(text(6000, 0), { rise: '0.0 mm', pan: '90\u00b0 \u21ba' });
});

test('home page: the 3D canvas is added, the drawn picture stays as the fallback', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /<canvas[^>]*id="device-3d"/);
  assert.match(html, /data-device-view="xray"/);
  assert.match(html, /data-device-view="opaque"/);
  assert.match(html, /id="device-3d-reset"/);
  // The old warning stays in the page for when the script does not run; the feedback caption replaces it.
  assert.match(html, /NOT POSITION FEEDBACK/);
  assert.match(html, /id="device-3d-caption"/);
  // The model reads the position from the PTZ page, so its script comes after ptz.js.
  const ptz = html.indexOf('<script src="ptz.js">');
  const viewer = html.indexOf('<script src="device-3d.js">');
  assert.ok(ptz > 0 && viewer > ptz);
  // The stage shows the model only once it is really drawn.
  const css = fs.readFileSync(path.join(WEB, 'console-ui.css'), 'utf8');
  assert.match(css, /\.has-3d/);
});

test('the numbers and the sensor tags need no CAD mesh: they also stand on the drawn picture', () => {
  const source = fs.readFileSync(path.join(WEB, 'device-3d.js'), 'utf8');
  // The readout starts before the mesh is asked for, so a build without the mesh still shows it.
  const readout = source.indexOf('const live = startReadout(stage);');
  const mesh = source.indexOf('    loadMeshScript()', readout);
  assert.ok(readout > 0 && mesh > readout);
  assert.match(source, /stage\.classList\.add\('has-feedback'\)/);
  const css = fs.readFileSync(path.join(WEB, 'console-ui.css'), 'utf8');
  assert.match(css, /\.motion-stage\.has-feedback \.device-3d-readout \{ display: flex;/);
  assert.match(css, /\.motion-stage\.has-feedback \.device-3d-caption \{ display: flex; \}/);
  assert.match(css, /\.motion-stage\.has-feedback \.stage-caption:not\(\.device-3d-caption\) \{ display: none; \}/);
  // Without the CAD the stroke is the 30 mm of the CAD, so the numbers are the same in every build.
  assert.match(source, /PLAIN_MOTION = \{ strokeMm: 30,/);
  assert.equal(META.strokeMm, 30);
});

test('the CAD mesh is optional: not in the offline list and not in the public repository', () => {
  const worker = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  assert.match(worker, /'\.\/device-3d\.js'/);
  assert.doesNotMatch(worker, /device-mesh/);
  const ignoreFile = path.join(REPO, '.gitignore');
  if (fs.existsSync(ignoreFile)) {
    assert.match(fs.readFileSync(ignoreFile, 'utf8'), /^apps\/airiz-motor\/web\/data\/device-mesh\.js$/m);
  }
});
