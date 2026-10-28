/* AIRIZ PTZ & smart camera (1.8.0) - Camera workspace.
 *
 * Arlo-style indoor pan/tilt features built on the real AIRIZ firmware commands:
 *   live view: click a spot to center it, hold an arrow to move (release = motor stop),
 *              digital zoom with drag
 *   position:  software position from every motor command sent (any view), home,
 *              soft limits, saved positions, auto scan between them
 *   privacy:   camera down to the lowest position, lights off, detection paused
 *   smart:     motion detection on the live picture with activity zones, sensitivity,
 *              active hours, event list with snapshots/clips, auto-tracking,
 *              spotlight / siren / desktop / Ziris PTB alerts
 *   night:     ALS-driven IR-cut + IR LED with hysteresis
 * Motion is open loop (no encoder): positions are tracked in software and flagged as
 * "estimated" after an interrupted move. Pure maths lives in ptz-core.js (unit tested).
 */
(function () {
  'use strict';

  const core = window.AirizPtzCore;
  const api = window.AirizConsole;
  const $ = id => document.getElementById(id);
  if (!core || !api || !$('ptz-card')) return;

  const STORE_KEY = 'airiz.ptz.v1';
  const HOLD_MAX_STEPS = 3000;
  const SETTLE_MS = 700;
  const DETECT_INTERVAL_MS = 200;
  const ANALYSIS_WIDTH = 160;
  const EVENT_LIMIT = 40;
  const TEAMS_COOLDOWN_MS = 120000;
  const SIREN_WAV = '/audio/16K_16bit_Stereo_Loud.wav';

  // ------------------------------------------------------------------ settings

  const defaults = {
    tracker: null,
    presets: [],
    calibration: { ...core.DEFAULT_CALIBRATION },
    timing: { ...core.DEFAULT_TIMING },
    speeds: { pan: 2, rising: 3 },
    zones: [],
    switchPressedValue: 1,
    detect: {
      sensitivity: 60,
      from: '',
      to: '',
      cooldown: 10,
      track: false,
      trackReturn: 30,
      spot: false,
      siren: false,
      clip: true,
      notify: false,
      teams: false
    },
    night: { auto: false, darkBelow: 10, brightAbove: 40 },
    scanDwell: 5,
    sirenSeconds: 10
  };

  function loadStore() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return {
        ...defaults,
        ...stored,
        calibration: { ...defaults.calibration, ...(stored.calibration || {}) },
        timing: { ...defaults.timing, ...(stored.timing || {}) },
        speeds: { ...defaults.speeds, ...(stored.speeds || {}) },
        detect: { ...defaults.detect, ...(stored.detect || {}) },
        night: { ...defaults.night, ...(stored.night || {}) },
        presets: Array.isArray(stored.presets) ? stored.presets.slice(0, 12) : [],
        zones: Array.isArray(stored.zones) ? stored.zones.slice(0, 4) : []
      };
    } catch {
      return JSON.parse(JSON.stringify(defaults));
    }
  }

  const store = loadStore();
  const tracker = core.createTracker(store.tracker);

  function save() {
    store.tracker = tracker.snapshot();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      // storage full / private mode: keep working in memory
    }
  }

  // ------------------------------------------------------------------ helpers

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function status(text, isError) {
    const line = $('ptz-status');
    if (!line) return;
    line.textContent = text;
    line.dataset.state = isError ? 'error' : 'ok';
  }

  function connected() {
    return api.getStatus().connected;
  }

  // Send a command and wait for its "#INFO#...#END#" answer (sensors, switches).
  function query(command, timeoutMs = 2500) {
    return new Promise(resolve => {
      let buffer = '';
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop();
        resolve(value);
      };
      const stop = api.onOutput(text => {
        buffer += text;
        const info = core.parseInfo(buffer);
        if (info) finish(info);
      });
      const timer = setTimeout(() => finish(null), timeoutMs);
      api.sendCommand(command).then(sent => {
        if (!sent) finish(null);
      });
    });
  }

  // ------------------------------------------------------------------ motion runner
  // Every motion goes through here: moves wait for the previous move to finish (time
  // model), stay inside the soft limits and can be cancelled by a newer action.
  let operation = 0;

  function newOperation() {
    operation += 1;
    return operation;
  }

  async function waitIdle(token) {
    const until = tracker.busyUntil();
    while (Date.now() < until) {
      if (token !== operation) return false;
      await sleep(Math.min(120, until - Date.now()));
    }
    return token === operation;
  }

  async function runMoves(moves, token) {
    for (const move of moves) {
      if (!(await waitIdle(token))) return false;
      const delta = tracker.clampDelta(move.axis, move.delta);
      const command = core.motorCommand(move.axis, delta, store.speeds[move.axis]);
      if (!command) continue;
      const sent = await api.sendCommand(command);
      if (!sent) {
        status('Motor command not sent. Check the connection and the console.', true);
        return false;
      }
    }
    return waitIdle(token);
  }

  async function moveTo(target, label) {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return false;
    }
    const moves = core.planMove(tracker, target);
    if (!moves.length) {
      status(label ? label + ': already there.' : 'Already there.');
      return true;
    }
    const token = newOperation();
    status((label ? 'Moving to ' + label : 'Moving') + '\u2026');
    const ok = await runMoves(moves, token);
    if (ok) {
      const clipped = moves.some(move => move.clipped);
      status((label ? 'At ' + label : 'Move finished') + (clipped ? ' (stopped at a soft limit).' : '.'));
    }
    return ok;
  }

  // ------------------------------------------------------------------ position UI

  function renderPosition() {
    const position = tracker.position;
    $('ptz-pos-readout').textContent = 'Pan ' + position.pan + ' \u00b7 Rising ' + position.rising;
    const badge = $('ptz-pos-state');
    if (!tracker.homed) {
      badge.textContent = 'Home not set';
      badge.dataset.state = 'warn';
    } else if (tracker.uncertain) {
      badge.textContent = 'Position estimated';
      badge.dataset.state = 'warn';
    } else {
      badge.textContent = 'Position tracked';
      badge.dataset.state = 'ok';
    }
    const limits = tracker.limits;
    const show = value => (Number.isFinite(value) ? String(value) : '\u2013');
    $('ptz-limits-text').textContent = 'Pan ' + show(limits.pan.min) + ' \u2026 ' + show(limits.pan.max)
      + ' \u00b7 Rising ' + show(limits.rising.min) + ' \u2026 ' + show(limits.rising.max);
  }

  function renderPresets() {
    const list = $('ptz-preset-list');
    if (!store.presets.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'No saved positions yet.';
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...store.presets.map((preset, index) => {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = preset.name;
        const where = document.createElement('span');
        where.className = 'ptz-preset-where';
        where.textContent = 'Pan ' + preset.pan + ' \u00b7 Rising ' + preset.rising;
        const go = document.createElement('button');
        go.className = 'btn btn-sm btn-primary';
        go.type = 'button';
        go.textContent = 'Go';
        go.dataset.presetGo = String(index);
        const remove = document.createElement('button');
        remove.className = 'btn btn-sm';
        remove.type = 'button';
        remove.textContent = 'Delete';
        remove.dataset.presetDelete = String(index);
        item.append(name, where, go, remove);
        return item;
      }));
    }
    $('ptz-scan-start').disabled = store.presets.length < 2 || scan.running;
  }

  api.onCommandSent(line => {
    const result = tracker.applyCommand(line, Date.now(), store.timing);
    if (!result) return;
    if (result.type === 'stop') {
      // A stop (button, Esc, hold release) cancels scans and tracking moves too.
      newOperation();
      if (scan.running) stopScan('Auto scan stopped (motor stop).');
    }
    save();
    renderPosition();
  });

  // ------------------------------------------------------------------ live view

  const stage = $('ptz-stage');
  const video = $('ptz-video');
  const overlay = $('ptz-overlay');
  const view = { zoom: 1, cx: 0.5, cy: 0.5, mode: 'move' };
  let liveStream = null;

  function applyZoom() {
    const center = core.clampViewCenter(view.cx, view.cy, view.zoom);
    view.cx = center.cx;
    view.cy = center.cy;
    const z = view.zoom;
    video.style.transform = 'scale(' + z + ') translate(' + (-(view.cx - 0.5 / z) * 100) + '%, ' + (-(view.cy - 0.5 / z) * 100) + '%)';
    $('ptz-zoom-value').textContent = z.toFixed(1) + '\u00d7';
    drawOverlay();
  }

  function setZoom(next) {
    view.zoom = Math.min(4, Math.max(1, Math.round(next * 10) / 10));
    applyZoom();
  }

  function attachStream() {
    const stream = api.getCameraStream();
    if (stream === liveStream) return;
    liveStream = stream;
    video.srcObject = stream || null;
    $('ptz-placeholder').hidden = !!stream;
    stage.classList.toggle('ptz-live', !!stream);
    if (stream) video.play().catch(() => {});
    else resetDetection();
  }

  video.addEventListener('loadedmetadata', () => {
    if (video.videoWidth && video.videoHeight) {
      stage.style.aspectRatio = video.videoWidth + ' / ' + video.videoHeight;
    }
    drawOverlay();
  });
  setInterval(attachStream, 1000);

  // Stage pixel -> frame coordinates (0..1), digital zoom included.
  function frameFromEvent(event) {
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return core.viewToFrame(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), view.zoom, view.cx, view.cy);
  }

  function frameToStage(u, v) {
    return { x: (u - view.cx) * view.zoom + 0.5, y: (v - view.cy) * view.zoom + 0.5 };
  }

  let lastMotion = null;
  let draftZone = null;
  let calibrationMark = null;

  function drawOverlay() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(stage.clientWidth * ratio));
    const height = Math.max(1, Math.round(stage.clientHeight * ratio));
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const rectOf = box => {
      const a = frameToStage(box.x, box.y);
      const b = frameToStage(box.x + box.w, box.y + box.h);
      return [a.x * width, a.y * height, (b.x - a.x) * width, (b.y - a.y) * height];
    };
    ctx.lineWidth = 2 * ratio;
    for (const zone of store.zones) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillRect(...rectOf(zone));
      ctx.strokeRect(...rectOf(zone));
    }
    if (draftZone) {
      ctx.setLineDash([6 * ratio, 4 * ratio]);
      ctx.strokeStyle = '#38bdf8';
      ctx.strokeRect(...rectOf(draftZone));
      ctx.setLineDash([]);
    }
    if (lastMotion && lastMotion.box && Date.now() - lastMotion.at < 1500) {
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
      ctx.strokeRect(...rectOf(lastMotion.box));
    }
    if (calibrationMark) {
      const p = frameToStage(calibrationMark.u, calibrationMark.v);
      ctx.strokeStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 10 * ratio, 0, Math.PI * 2);
      ctx.stroke();
    }
    // centre cross
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1 * ratio;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 10 * ratio, height / 2);
    ctx.lineTo(width / 2 + 10 * ratio, height / 2);
    ctx.moveTo(width / 2, height / 2 - 10 * ratio);
    ctx.lineTo(width / 2, height / 2 + 10 * ratio);
    ctx.stroke();
  }
  window.addEventListener('resize', drawOverlay);

  // Pointer: click = center that spot (or calibration click), drag = pan the digital
  // zoom (move mode) or draw an activity zone (zone mode).
  let pointer = null;
  overlay.addEventListener('pointerdown', event => {
    if (!liveStream) return;
    overlay.setPointerCapture(event.pointerId);
    pointer = { x: event.clientX, y: event.clientY, start: frameFromEvent(event), cx: view.cx, cy: view.cy, moved: false };
  });
  overlay.addEventListener('pointermove', event => {
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) pointer.moved = true;
    if (!pointer.moved) return;
    if (view.mode === 'zones') {
      const end = frameFromEvent(event);
      draftZone = {
        x: Math.min(pointer.start.u, end.u),
        y: Math.min(pointer.start.v, end.v),
        w: Math.abs(end.u - pointer.start.u),
        h: Math.abs(end.v - pointer.start.v)
      };
      drawOverlay();
    } else if (view.zoom > 1) {
      const rect = stage.getBoundingClientRect();
      view.cx = pointer.cx - dx / rect.width / view.zoom;
      view.cy = pointer.cy - dy / rect.height / view.zoom;
      applyZoom();
    }
  });
  overlay.addEventListener('pointerup', event => {
    if (!pointer) return;
    const wasMoved = pointer.moved;
    pointer = null;
    if (view.mode === 'zones') {
      if (draftZone && draftZone.w > 0.03 && draftZone.h > 0.03) {
        store.zones = [...store.zones, draftZone].slice(-4);
        save();
        renderZones();
        resetDetection();
      }
      draftZone = null;
      drawOverlay();
      return;
    }
    if (wasMoved) return;
    const point = frameFromEvent(event);
    if (calibration.waiting) {
      calibrationClick(point);
      return;
    }
    centerOn(point);
  });
  overlay.addEventListener('wheel', event => {
    if (!liveStream) return;
    event.preventDefault();
    setZoom(view.zoom + (event.deltaY < 0 ? 0.25 : -0.25));
  }, { passive: false });

  async function centerOn(point) {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return;
    }
    stopScan();
    const steps = core.stepsToCenter(point.u, point.v, store.calibration);
    const target = { pan: tracker.position.pan + steps.pan, rising: tracker.position.rising + steps.rising };
    view.cx = 0.5;
    view.cy = 0.5;
    applyZoom();
    await moveTo(target, null);
    resetDetection();
  }

  // Hold an arrow: one long move toward the limit, released = motor stop.
  let hold = null;
  function startHold(button) {
    if (!connected() || hold) return;
    const [axis, direction] = button.dataset.hold.split(':');
    const delta = tracker.clampDelta(axis, Number(direction) * HOLD_MAX_STEPS);
    if (!delta) {
      status('Soft limit reached on ' + axis + '.', true);
      return;
    }
    stopScan();
    const token = newOperation();
    hold = { token, button };
    button.classList.add('ptz-holding');
    waitIdle(token).then(idle => {
      if (!idle || !hold || hold.token !== token) return;
      api.sendCommand(core.motorCommand(axis, tracker.clampDelta(axis, Number(direction) * HOLD_MAX_STEPS), store.speeds[axis]));
    });
  }
  function endHold() {
    if (!hold) return;
    hold.button.classList.remove('ptz-holding');
    hold = null;
    if (Date.now() < tracker.busyUntil()) api.stopMotor();
    resetDetection();
  }
  document.querySelectorAll('[data-hold]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      startHold(button);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, endHold);
    button.addEventListener('keydown', event => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
        event.preventDefault();
        startHold(button);
      }
    });
    button.addEventListener('keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') endHold();
    });
  });

  function setMode(mode) {
    view.mode = mode;
    document.querySelectorAll('[data-ptz-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.ptzMode === mode));
    });
    stage.dataset.mode = mode;
    $('ptz-hint').textContent = mode === 'zones'
      ? 'Drag on the picture to draw up to 4 activity zones. Motion outside the zones is ignored.'
      : 'Click the picture to center that spot. Hold an arrow to move, release to stop. Wheel = digital zoom, drag = look around when zoomed.';
  }
  document.querySelectorAll('[data-ptz-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.ptzMode)));
  $('ptz-zoom-in').addEventListener('click', () => setZoom(view.zoom + 0.5));
  $('ptz-zoom-out').addEventListener('click', () => setZoom(view.zoom - 0.5));

  function grabFrame(maxWidth) {
    if (!liveStream || !video.videoWidth) return null;
    const scale = maxWidth ? Math.min(1, maxWidth / video.videoWidth) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function download(url, name) {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  }

  $('ptz-snapshot').addEventListener('click', () => {
    const canvas = grabFrame();
    if (!canvas) {
      status('Start Preview first.', true);
      return;
    }
    // The snapshot keeps what you see: the digital zoom crop at full resolution.
    const z = view.zoom;
    const crop = document.createElement('canvas');
    crop.width = Math.round(canvas.width / z);
    crop.height = Math.round(canvas.height / z);
    crop.getContext('2d').drawImage(canvas, (view.cx - 0.5 / z) * canvas.width, (view.cy - 0.5 / z) * canvas.height,
      crop.width, crop.height, 0, 0, crop.width, crop.height);
    crop.toBlob(blob => {
      if (blob) download(URL.createObjectURL(blob), 'airiz-ptz-' + stamp() + '.jpg');
    }, 'image/jpeg', 0.92);
    status('Snapshot saved (' + crop.width + '\u00d7' + crop.height + ').');
  });

  // ------------------------------------------------------------------ home, limits, presets

  $('ptz-set-home').addEventListener('click', () => {
    tracker.setHome();
    save();
    renderPosition();
    status('Home set here. Positions are now counted from this point.');
  });
  $('ptz-go-home').addEventListener('click', () => {
    stopScan();
    moveTo({ pan: 0, rising: 0 }, 'home');
  });
  document.querySelectorAll('[data-limit]').forEach(button => button.addEventListener('click', () => {
    const [axis, side] = button.dataset.limit.split(':');
    tracker.setLimit(axis, side, tracker.position[axis]);
    save();
    renderPosition();
    status('Soft limit saved: ' + axis + ' ' + side + ' = ' + tracker.position[axis] + '. Moves from this console stop there.');
  }));
  $('ptz-clear-limits').addEventListener('click', () => {
    for (const axis of core.AXES) {
      tracker.setLimit(axis, 'min', null);
      tracker.setLimit(axis, 'max', null);
    }
    save();
    renderPosition();
    status('Soft limits cleared.');
  });

  $('ptz-preset-save').addEventListener('click', () => {
    const input = $('ptz-preset-name');
    const name = input.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30) || ('Position ' + (store.presets.length + 1));
    if (store.presets.length >= 12) {
      status('Up to 12 saved positions. Delete one first.', true);
      return;
    }
    const position = tracker.position;
    store.presets = [...store.presets.filter(preset => preset.name !== name), { name, pan: position.pan, rising: position.rising }];
    input.value = '';
    save();
    renderPresets();
    status('Saved "' + name + '".');
  });
  $('ptz-preset-list').addEventListener('click', event => {
    const go = event.target.closest('[data-preset-go]');
    const remove = event.target.closest('[data-preset-delete]');
    if (go) {
      stopScan();
      const preset = store.presets[Number(go.dataset.presetGo)];
      if (preset) moveTo(preset, '"' + preset.name + '"');
    }
    if (remove) {
      store.presets.splice(Number(remove.dataset.presetDelete), 1);
      save();
      renderPresets();
    }
  });

  // Auto scan: visit every saved position, wait, repeat until stopped.
  const scan = { running: false, token: 0 };
  async function startScan() {
    if (store.presets.length < 2) return;
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return;
    }
    const dwell = Math.min(600, Math.max(2, Number($('ptz-scan-dwell').value) || 5));
    store.scanDwell = dwell;
    save();
    scan.running = true;
    scan.token = newOperation();
    const token = scan.token;
    $('ptz-scan-stop').disabled = false;
    renderPresets();
    let round = 0;
    while (scan.running && token === operation) {
      round += 1;
      for (const preset of store.presets) {
        if (!scan.running || token !== operation) break;
        status('Auto scan round ' + round + ': ' + preset.name + '\u2026');
        const ok = await runMoves(core.planMove(tracker, preset), token);
        if (!ok) break;
        resetDetection();
        const until = Date.now() + dwell * 1000;
        while (Date.now() < until && scan.running && token === operation) await sleep(200);
      }
    }
    if (scan.running) stopScan('Auto scan stopped.');
  }
  function stopScan(message) {
    if (!scan.running) return;
    scan.running = false;
    newOperation();
    $('ptz-scan-stop').disabled = true;
    renderPresets();
    if (message) status(message);
  }
  $('ptz-scan-start').addEventListener('click', startScan);
  $('ptz-scan-stop').addEventListener('click', () => stopScan('Auto scan stopped.'));

  // ------------------------------------------------------------------ privacy & rising switch

  const privacy = { on: false, before: null, detectWasOn: false };

  async function readSwitch() {
    const info = await query('diag button get rising-det');
    if (!info || info.number === null) {
      $('ptz-switch-state').textContent = 'No answer from the rising switch.';
      return null;
    }
    const pressed = info.number === Number(store.switchPressedValue);
    $('ptz-switch-state').textContent = 'Rising switch: ' + info.value + (pressed ? ' (pressed, camera down)' : ' (released)');
    return pressed;
  }
  $('ptz-read-switch').addEventListener('click', () => {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return;
    }
    readSwitch();
  });

  // Lower the camera in small steps until the rising switch reports "pressed",
  // then make that the rising zero and the lowest soft limit.
  $('ptz-find-rising-home').addEventListener('click', async () => {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return;
    }
    stopScan();
    const token = newOperation();
    const chunk = 60;
    const maxTotal = 1800;
    let moved = 0;
    status('Finding rising home: lowering until the switch is pressed\u2026');
    while (moved <= maxTotal) {
      if (token !== operation) return;
      const pressed = await readSwitch();
      if (pressed === null) {
        status('The rising switch did not answer. Rising home not found.', true);
        return;
      }
      if (pressed) {
        tracker.setAxisZero('rising');
        tracker.setLimit('rising', 'min', 0);
        save();
        renderPosition();
        status('Rising home found after ' + moved + ' steps down. Rising = 0 is now the lowest position (privacy).');
        return;
      }
      const sent = await api.sendCommand(core.motorCommand('rising', -chunk, store.speeds.rising));
      if (!sent) return;
      moved += chunk;
      if (!(await waitIdle(token))) return;
      await sleep(150);
    }
    status('Lowered ' + maxTotal + ' steps without the switch pressing. Check "Switch pressed value" in Calibration.', true);
  });

  $('ptz-privacy-on').addEventListener('click', async () => {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return;
    }
    const lowest = tracker.limits.rising.min;
    if (!Number.isFinite(lowest)) {
      status('Set the lowest rising position first: "Find rising home", or lower the camera and press "Set lowest".', true);
      return;
    }
    stopScan();
    stopTracking();
    privacy.before = tracker.position;
    privacy.detectWasOn = detection.armed;
    setArmed(false);
    privacy.on = true;
    renderPrivacy();
    await moveTo({ pan: tracker.position.pan, rising: lowest }, 'privacy position');
    await api.sendCommand('diag spotled off');
    await api.sendCommand('diag irled off');
    status('Privacy on: camera lowered, lights off, motion detection paused.');
  });
  $('ptz-privacy-off').addEventListener('click', async () => {
    if (!privacy.on) return;
    privacy.on = false;
    renderPrivacy();
    if (privacy.before) await moveTo(privacy.before, 'the position before privacy');
    if (privacy.detectWasOn) setArmed(true);
    status('Privacy off.');
  });
  function renderPrivacy() {
    $('ptz-card').classList.toggle('ptz-privacy', privacy.on);
    $('ptz-privacy-on').disabled = privacy.on;
    $('ptz-privacy-off').disabled = !privacy.on;
  }

  // ------------------------------------------------------------------ smart detection

  const detection = {
    armed: false,
    previous: null,
    gray: null,
    mask: null,
    maskKey: '',
    consecutive: 0,
    nextEventAt: 0,
    lastMotionAt: 0,
    trackedAway: false,
    anchor: null,
    lastTeamsAt: 0,
    canvas: document.createElement('canvas'),
    events: []
  };

  function resetDetection() {
    detection.previous = null;
    detection.consecutive = 0;
  }

  function setArmed(on) {
    detection.armed = !!on;
    $('ptz-detect-arm').checked = detection.armed;
    if (detection.armed) {
      detection.anchor = tracker.position;
      detection.trackedAway = false;
      resetDetection();
    }
    renderDetectStatus();
  }

  function renderDetectStatus(extra) {
    const line = $('ptz-detect-status');
    if (!detection.armed) {
      line.textContent = 'Motion detection is off.';
    } else if (!liveStream) {
      line.textContent = 'Armed. Start Preview with the AIRIZ camera so the picture can be watched.';
    } else if (!core.isWithinSchedule(new Date(), store.detect.from, store.detect.to)) {
      line.textContent = 'Armed, outside the active hours (' + store.detect.from + '\u2013' + store.detect.to + ').';
    } else {
      line.textContent = extra || 'Armed and watching' + (store.detect.track ? ' with auto-tracking.' : '.');
    }
  }

  function renderZones() {
    $('ptz-zones-count').textContent = store.zones.length
      ? store.zones.length + ' zone' + (store.zones.length > 1 ? 's' : '')
      : 'Whole picture';
  }

  function stopTracking() {
    detection.trackedAway = false;
  }

  function analyse() {
    if (!liveStream || !video.videoWidth || document.hidden) return;
    const now = Date.now();
    // Ignore the picture while the camera itself moves (and shortly after).
    if (now < tracker.busyUntil() + SETTLE_MS) {
      resetDetection();
      return;
    }
    const width = ANALYSIS_WIDTH;
    const height = Math.max(1, Math.round(ANALYSIS_WIDTH * video.videoHeight / video.videoWidth));
    const canvas = detection.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, width, height);
    const gray = core.toGray(ctx.getImageData(0, 0, width, height).data);
    const maskKey = width + 'x' + height + JSON.stringify(store.zones);
    if (detection.maskKey !== maskKey) {
      detection.mask = core.buildZoneMask(store.zones, width, height);
      detection.maskKey = maskKey;
    }
    const previous = detection.previous;
    detection.previous = gray;
    if (!previous || previous.length !== gray.length) return;
    const result = core.detectMotion(previous, gray, width, height, detection.mask, core.sensitivityToThresholds(store.detect.sensitivity));
    $('ptz-motion-level').style.width = Math.min(100, Math.round(result.fraction * 1000)) + '%';
    if (!result.motion) {
      detection.consecutive = 0;
      maybeReturnFromTracking(now);
      return;
    }
    lastMotion = { box: result.box, at: now };
    drawOverlay();
    detection.consecutive += 1;
    detection.lastMotionAt = now;
    if (!detection.armed || privacy.on || detection.consecutive < 2) return;
    if (!core.isWithinSchedule(new Date(), store.detect.from, store.detect.to)) return;
    if (now >= detection.nextEventAt) {
      detection.nextEventAt = now + Math.max(3, Number(store.detect.cooldown) || 10) * 1000;
      recordEvent(result);
    }
    if (store.detect.track) track(result);
  }

  async function track(result) {
    if (scan.running || hold || Date.now() < tracker.busyUntil()) return;
    const move = core.trackingMove(result.centroid, { calibration: store.calibration });
    if (!move) return;
    const moves = [];
    for (const axis of core.AXES) {
      const delta = tracker.clampDelta(axis, move[axis]);
      if (delta) moves.push({ axis, delta });
    }
    if (!moves.length) return;
    detection.trackedAway = true;
    renderDetectStatus('Tracking movement\u2026');
    await runMoves(moves, newOperation());
    resetDetection();
  }

  function maybeReturnFromTracking(now) {
    if (!detection.trackedAway || !detection.armed || !store.detect.track) return;
    const wait = Math.max(5, Number(store.detect.trackReturn) || 30) * 1000;
    if (now - detection.lastMotionAt < wait || Date.now() < tracker.busyUntil()) return;
    detection.trackedAway = false;
    const target = tracker.homed ? { pan: 0, rising: 0 } : detection.anchor;
    if (target) {
      renderDetectStatus('No motion for ' + Math.round(wait / 1000) + ' s: returning.');
      moveTo(target, tracker.homed ? 'home' : 'the start position').then(resetDetection);
    }
  }

  function recordEvent(result) {
    const at = new Date();
    const thumb = grabFrame(240);
    const event = { at, fraction: result.fraction, thumb: thumb ? thumb.toDataURL('image/jpeg', 0.7) : '', photo: '', clip: '' };
    const full = grabFrame();
    if (full) {
      full.toBlob(blob => {
        if (blob) {
          event.photo = URL.createObjectURL(blob);
          renderEvents();
        }
      }, 'image/jpeg', 0.9);
    }
    detection.events.unshift(event);
    for (const old of detection.events.splice(EVENT_LIMIT)) {
      if (old.photo) URL.revokeObjectURL(old.photo);
      if (old.clip) URL.revokeObjectURL(old.clip);
    }
    renderEvents();
    renderDetectStatus('Motion at ' + at.toLocaleTimeString() + ' (' + (result.fraction * 100).toFixed(1) + '% of the zone).');
    runActions(event);
  }

  function renderEvents() {
    const list = $('ptz-events');
    if (!detection.events.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'No motion events yet.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...detection.events.map(event => {
      const item = document.createElement('li');
      if (event.thumb) {
        const image = document.createElement('img');
        image.src = event.thumb;
        image.alt = 'Motion at ' + event.at.toLocaleTimeString();
        item.append(image);
      }
      const text = document.createElement('div');
      const time = document.createElement('strong');
      time.textContent = event.at.toLocaleTimeString();
      text.append(time, document.createTextNode(' \u00b7 ' + (event.fraction * 100).toFixed(1) + '%'));
      const links = document.createElement('div');
      links.className = 'ptz-event-links';
      if (event.photo) {
        const photo = document.createElement('a');
        photo.href = event.photo;
        photo.download = 'airiz-motion-' + event.at.toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.jpg';
        photo.textContent = 'Photo';
        links.append(photo);
      }
      if (event.clip) {
        const clip = document.createElement('a');
        clip.href = event.clip;
        clip.download = 'airiz-motion-' + event.at.toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.webm';
        clip.textContent = 'Clip';
        links.append(clip);
      }
      text.append(links);
      item.append(text);
      return item;
    }));
  }

  // ------------------------------------------------------------------ event actions

  let spotTimer = null;
  let clipRecorder = null;

  function runActions(event) {
    const settings = store.detect;
    if (settings.spot && connected()) {
      if (!spotTimer) api.sendCommand('diag spotled on');
      clearTimeout(spotTimer);
      spotTimer = setTimeout(() => {
        spotTimer = null;
        if (connected()) api.sendCommand('diag spotled off');
      }, 30000);
    }
    if (settings.siren && !siren.active) startSiren(store.sirenSeconds);
    if (settings.clip) recordClip(event, 10);
    if (settings.notify && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('AIRIZ motion', { body: 'Motion at ' + event.at.toLocaleTimeString(), icon: event.thumb || undefined, silent: false });
      } catch {
        // some platforms refuse page notifications; the event list still has it
      }
    }
    if (settings.teams && window.AirizTeam && Date.now() - detection.lastTeamsAt > TEAMS_COOLDOWN_MS) {
      detection.lastTeamsAt = Date.now();
      window.AirizTeam.postAlert({
        title: 'AIRIZ motion alert',
        text: 'Motion detected by the AIRIZ camera at ' + event.at.toLocaleTimeString() + ' ('
          + (event.fraction * 100).toFixed(1) + '% of the watched area).'
      }).then(result => {
        if (!result.ok) renderDetectStatus('Teams alert not sent: ' + result.error);
      });
    }
  }

  function recordClip(event, seconds) {
    if (clipRecorder || !liveStream || typeof MediaRecorder !== 'function') return;
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(item => MediaRecorder.isTypeSupported(item));
    let recorder;
    try {
      recorder = new MediaRecorder(liveStream, type ? { mimeType: type } : undefined);
    } catch {
      return;
    }
    const chunks = [];
    clipRecorder = recorder;
    recorder.ondataavailable = item => {
      if (item.data && item.data.size) chunks.push(item.data);
    };
    recorder.onstop = () => {
      clipRecorder = null;
      if (chunks.length) {
        event.clip = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
        renderEvents();
      }
    };
    recorder.start(1000);
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, seconds * 1000);
  }

  // Siren: the AIRIZ speaker plays the loud test sound repeatedly, spotlight on.
  // (The firmware has no "stop playback" command: the sound in progress finishes.)
  const siren = { active: false, timer: null, until: 0 };
  async function startSiren(seconds) {
    if (!connected() || siren.active) return;
    const duration = Math.min(120, Math.max(3, Number(seconds) || 10));
    siren.active = true;
    siren.until = Date.now() + duration * 1000;
    $('ptz-siren').disabled = true;
    $('ptz-siren-stop').disabled = false;
    await api.sendCommand('diag audio init');
    await sleep(400);
    await api.sendCommand('diag audio volume 100');
    await api.sendCommand('diag spotled on');
    const play = async () => {
      if (!siren.active || Date.now() >= siren.until) {
        stopSiren();
        return;
      }
      await api.sendCommand('diag audio play ' + SIREN_WAV);
      siren.timer = setTimeout(play, 4000);
    };
    play();
    status('Siren on for ' + duration + ' s.');
  }
  function stopSiren() {
    if (!siren.active) return;
    siren.active = false;
    clearTimeout(siren.timer);
    $('ptz-siren').disabled = false;
    $('ptz-siren-stop').disabled = true;
    if (connected()) api.sendCommand('diag spotled off');
    status('Siren stopped.');
  }
  $('ptz-siren').addEventListener('click', () => startSiren($('ptz-siren-seconds').value));
  $('ptz-siren-stop').addEventListener('click', stopSiren);

  // ------------------------------------------------------------------ automatic night vision

  const night = { mode: null, lux: null, busy: false };
  async function nightTick() {
    if (!store.night.auto || night.busy || !connected() || api.getStatus().macroRunning) return;
    night.busy = true;
    try {
      const info = await query('diag als value');
      if (!info || info.number === null) {
        $('ptz-night-state').textContent = 'ALS did not answer.';
        return;
      }
      night.lux = info.number;
      const next = core.nightModeDecision(info.number, night.mode, store.night);
      if (next === 'night') {
        await api.sendCommand('diag ircut night');
        await api.sendCommand('diag irled on');
      } else if (next === 'day') {
        await api.sendCommand('diag irled off');
        await api.sendCommand('diag ircut day');
      }
      if (next) night.mode = next;
      $('ptz-night-state').textContent = 'ALS ' + info.number + ' \u00b7 ' + (night.mode === 'night' ? 'Night (IR)' : night.mode === 'day' ? 'Day' : 'between thresholds');
    } finally {
      night.busy = false;
    }
  }
  setInterval(nightTick, 15000);

  // ------------------------------------------------------------------ calibration

  const calibration = { waiting: false, axis: 'pan', steps: 100, first: null };

  function calibrationClick(point) {
    const value = calibration.axis === 'pan' ? point.u : point.v;
    if (!calibration.first) {
      calibration.first = value;
      calibrationMark = point;
      drawOverlay();
      calibration.waiting = false;
      $('ptz-cal-status').textContent = 'Moving ' + calibration.axis + ' ' + calibration.steps + ' steps\u2026';
      const token = newOperation();
      runMoves([{ axis: calibration.axis, delta: calibration.steps }], token).then(async ok => {
        if (!ok) {
          $('ptz-cal-status').textContent = 'Calibration cancelled.';
          calibrationMark = null;
          return;
        }
        await sleep(500);
        calibration.waiting = true;
        $('ptz-cal-status').textContent = 'Now click the SAME object again.';
      });
      return;
    }
    calibration.waiting = false;
    calibrationMark = null;
    drawOverlay();
    try {
      const perFrame = core.calibrateAxis(calibration.first, value, calibration.steps);
      store.calibration[calibration.axis === 'pan' ? 'panStepsPerFrame' : 'risingStepsPerFrame'] = perFrame;
      save();
      renderCalibration();
      $('ptz-cal-status').textContent = 'Calibrated: ' + perFrame + ' steps per picture ' + (calibration.axis === 'pan' ? 'width' : 'height') + '. Moving back\u2026';
    } catch (error) {
      $('ptz-cal-status').textContent = error.message;
    }
    calibration.first = null;
    runMoves([{ axis: calibration.axis, delta: -calibration.steps }], newOperation());
  }

  $('ptz-cal-start').addEventListener('click', () => {
    if (!liveStream || !connected()) {
      $('ptz-cal-status').textContent = 'Connect the AIRIZ and Start Preview first.';
      return;
    }
    setMode('move');
    calibration.axis = $('ptz-cal-axis').value === 'rising' ? 'rising' : 'pan';
    calibration.steps = Math.min(2000, Math.max(10, Number($('ptz-cal-steps').value) || 100));
    calibration.first = null;
    calibration.waiting = true;
    $('ptz-cal-status').textContent = 'Click a clear object in the picture (a corner, a lamp\u2026).';
  });

  // Timing: run a move and press "It stopped" when the motor stops.
  const timingTest = { startedAt: 0, axis: 'pan', steps: 0, speed: 1 };
  $('ptz-time-start').addEventListener('click', async () => {
    if (!connected()) {
      $('ptz-cal-status').textContent = 'Connect the AIRIZ first.';
      return;
    }
    timingTest.axis = $('ptz-time-axis').value === 'rising' ? 'rising' : 'pan';
    timingTest.steps = Math.min(5000, Math.max(20, Number($('ptz-time-steps').value) || 200));
    timingTest.speed = store.speeds[timingTest.axis];
    const delta = tracker.clampDelta(timingTest.axis, timingTest.steps);
    if (delta !== timingTest.steps) {
      $('ptz-cal-status').textContent = 'Not enough room before the soft limit for ' + timingTest.steps + ' steps forward.';
      return;
    }
    const sent = await api.sendCommand(core.motorCommand(timingTest.axis, delta, timingTest.speed));
    if (!sent) return;
    timingTest.startedAt = performance.now();
    $('ptz-time-done').disabled = false;
    $('ptz-cal-status').textContent = 'Watch the camera and press "It stopped" the moment it stops.';
  });
  $('ptz-time-done').addEventListener('click', () => {
    if (!timingTest.startedAt) return;
    const measured = performance.now() - timingTest.startedAt;
    timingTest.startedAt = 0;
    $('ptz-time-done').disabled = true;
    const k = core.timingFromMeasurement(timingTest.steps, timingTest.speed, measured);
    if (!k) return;
    store.timing[timingTest.axis] = Math.round(k * 10) / 10;
    save();
    renderCalibration();
    $('ptz-cal-status').textContent = timingTest.axis + ': ' + timingTest.steps + ' steps took ' + (measured / 1000).toFixed(2)
      + ' s at speed ' + timingTest.speed + ' \u2192 timing ' + store.timing[timingTest.axis] + '.';
  });

  function renderCalibration() {
    $('ptz-cal-pan').value = store.calibration.panStepsPerFrame;
    $('ptz-cal-rising').value = store.calibration.risingStepsPerFrame;
    $('ptz-time-pan').value = store.timing.pan;
    $('ptz-time-rising').value = store.timing.rising;
    $('ptz-pan-speed').value = store.speeds.pan;
    $('ptz-rising-speed').value = store.speeds.rising;
    $('ptz-switch-value').value = String(store.switchPressedValue);
  }

  function bindNumber(id, apply) {
    $(id).addEventListener('change', () => {
      const value = Number($(id).value);
      if (Number.isFinite(value)) {
        apply(value);
        save();
      }
      renderCalibration();
    });
  }
  bindNumber('ptz-cal-pan', value => { if (value) store.calibration.panStepsPerFrame = Math.round(value); });
  bindNumber('ptz-cal-rising', value => { if (value) store.calibration.risingStepsPerFrame = Math.round(value); });
  bindNumber('ptz-time-pan', value => { if (value > 0) store.timing.pan = value; });
  bindNumber('ptz-time-rising', value => { if (value > 0) store.timing.rising = value; });
  bindNumber('ptz-pan-speed', value => { store.speeds.pan = Math.min(17, Math.max(1, Math.round(value))); });
  bindNumber('ptz-rising-speed', value => { store.speeds.rising = Math.min(30, Math.max(1, Math.round(value))); });
  $('ptz-switch-value').addEventListener('change', () => {
    store.switchPressedValue = Number($('ptz-switch-value').value) === 0 ? 0 : 1;
    save();
  });

  // ------------------------------------------------------------------ detection settings

  function bindDetect() {
    const settings = store.detect;
    $('ptz-detect-arm').addEventListener('change', () => {
      setArmed($('ptz-detect-arm').checked);
    });
    const sensitivity = $('ptz-sensitivity');
    sensitivity.value = settings.sensitivity;
    $('ptz-sensitivity-value').textContent = settings.sensitivity;
    sensitivity.addEventListener('input', () => {
      settings.sensitivity = Number(sensitivity.value);
      $('ptz-sensitivity-value').textContent = sensitivity.value;
      save();
    });
    for (const [id, key] of [['ptz-hours-from', 'from'], ['ptz-hours-to', 'to']]) {
      $(id).value = settings[key];
      $(id).addEventListener('change', () => {
        settings[key] = $(id).value;
        save();
        renderDetectStatus();
      });
    }
    for (const [id, key] of [['ptz-act-track', 'track'], ['ptz-act-spot', 'spot'], ['ptz-act-siren', 'siren'],
      ['ptz-act-clip', 'clip'], ['ptz-act-notify', 'notify'], ['ptz-act-teams', 'teams']]) {
      $(id).checked = !!settings[key];
      $(id).addEventListener('change', async () => {
        settings[key] = $(id).checked;
        if (key === 'notify' && settings.notify && 'Notification' in window && Notification.permission === 'default') {
          await Notification.requestPermission();
        }
        if (key === 'teams' && settings.teams && !(window.AirizTeam && window.AirizTeam.member)) {
          renderDetectStatus('Teams alerts need Ziris PTB membership (Team page).');
        }
        if (key === 'track' && !settings.track) stopTracking();
        save();
        renderDetectStatus();
      });
    }
    for (const [id, key] of [['ptz-track-return', 'trackReturn'], ['ptz-cooldown', 'cooldown']]) {
      $(id).value = settings[key];
      $(id).addEventListener('change', () => {
        settings[key] = Math.max(3, Number($(id).value) || defaults.detect[key]);
        $(id).value = settings[key];
        save();
      });
    }
    $('ptz-zones-clear').addEventListener('click', () => {
      store.zones = [];
      save();
      renderZones();
      resetDetection();
      drawOverlay();
    });
    $('ptz-events-clear').addEventListener('click', () => {
      for (const event of detection.events) {
        if (event.photo) URL.revokeObjectURL(event.photo);
        if (event.clip) URL.revokeObjectURL(event.clip);
      }
      detection.events = [];
      renderEvents();
    });
    $('ptz-auto-night').checked = store.night.auto;
    $('ptz-auto-night').addEventListener('change', () => {
      store.night.auto = $('ptz-auto-night').checked;
      night.mode = null;
      save();
      $('ptz-night-state').textContent = store.night.auto ? 'Reading the light sensor\u2026' : '';
      if (store.night.auto) nightTick();
    });
    for (const [id, key] of [['ptz-night-dark', 'darkBelow'], ['ptz-night-bright', 'brightAbove']]) {
      $(id).value = store.night[key];
      $(id).addEventListener('change', () => {
        const value = Number($(id).value);
        if (Number.isFinite(value) && value >= 0) store.night[key] = value;
        if (store.night.brightAbove <= store.night.darkBelow) store.night.brightAbove = store.night.darkBelow + 1;
        $('ptz-night-dark').value = store.night.darkBelow;
        $('ptz-night-bright').value = store.night.brightAbove;
        save();
      });
    }
    $('ptz-siren-seconds').value = store.sirenSeconds;
    $('ptz-siren-seconds').addEventListener('change', () => {
      store.sirenSeconds = Math.min(120, Math.max(3, Number($('ptz-siren-seconds').value) || 10));
      $('ptz-siren-seconds').value = store.sirenSeconds;
      save();
    });
    $('ptz-scan-dwell').value = store.scanDwell;
  }

  // ------------------------------------------------------------------ start

  bindDetect();
  renderCalibration();
  renderPosition();
  renderPresets();
  renderZones();
  renderEvents();
  renderPrivacy();
  setMode('move');
  applyZoom();
  setArmed(false);
  $('ptz-siren-stop').disabled = true;
  setInterval(analyse, DETECT_INTERVAL_MS);
  setInterval(() => renderDetectStatus(), 5000);

  // Small API for tests and other modules (read-only state + the same actions as the UI).
  window.AirizPtz = Object.freeze({
    get position() {
      return tracker.position;
    },
    get limits() {
      return tracker.limits;
    },
    get presets() {
      return store.presets.map(preset => ({ ...preset }));
    },
    get events() {
      return detection.events.map(event => ({ at: event.at.toISOString(), fraction: event.fraction, photo: !!event.photo, clip: !!event.clip }));
    },
    get armed() {
      return detection.armed;
    },
    get privacy() {
      return privacy.on;
    },
    centerOn: (u, v) => centerOn({ u, v }),
    moveTo: (pan, rising, label) => moveTo({ pan, rising }, label),
    readSwitch,
    nightTick
  });
})();
