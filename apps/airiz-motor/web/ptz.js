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
  // 1.11.10: user-set durations for the Smart detection actions (clips stay in memory, so they are capped).
  const DURATION_LIMITS = {
    clipSeconds: { min: 3, max: 60, fallback: 10 },
    spotSeconds: { min: 5, max: 600, fallback: 30 }
  };

  function durationSetting(key, value) {
    const limits = DURATION_LIMITS[key];
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || number <= 0) return limits.fallback;
    return Math.min(limits.max, Math.max(limits.min, number));
  }

  // ------------------------------------------------------------------ settings

  const defaults = {
    tracker: null,
    presets: [],
    calibration: { ...core.DEFAULT_CALIBRATION },
    timing: { ...core.DEFAULT_TIMING },
    travel: { ...core.DEFAULT_TRAVEL },
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
      clipSeconds: 10,
      spotSeconds: 30,
      notify: false,
      teams: false
    },
    night: { auto: false, darkBelow: 10, brightAbove: 40 },
    scanDwell: 5,
    sirenSeconds: 10,
    // 1.11.17: 'tone' (generated wail), 'testwav' (test sound on the AIRIZ) or 'custom'
    sirenSound: 'tone'
  };

  function loadStore() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return {
        ...defaults,
        ...stored,
        calibration: { ...defaults.calibration, ...(stored.calibration || {}) },
        timing: { ...defaults.timing, ...(stored.timing || {}) },
        travel: core.normalizeTravel(stored.travel),
        speeds: { ...defaults.speeds, ...(stored.speeds || {}) },
        detect: { ...defaults.detect, ...(stored.detect || {}) },
        night: { ...defaults.night, ...(stored.night || {}) },
        // 1.11.17: the old "built-in loud tone" (the AIRIZ test sound) becomes the real siren tone
        sirenSound: ['tone', 'testwav', 'custom'].includes(stored.sirenSound) ? stored.sirenSound : 'tone',
        presets: Array.isArray(stored.presets) ? stored.presets.slice(0, 12) : [],
        zones: Array.isArray(stored.zones) ? stored.zones.slice(0, 4) : []
      };
    } catch {
      return JSON.parse(JSON.stringify(defaults));
    }
  }

  const store = loadStore();
  const tracker = core.createTracker(store.tracker);
  tracker.setTravel(store.travel);

  // ------------------------------------------------------------------ shared camera (1.11.1)
  // The console that holds the AIRIZ cable (a PC, or a phone since 1.11.0) sees every move:
  // its own and those of every device that controls through it by code. It shares its
  // tracked camera (position, Home, limits, the move in flight, its last PTZ message) with
  // those devices, and they ask it to go home, set home, save limits or find the rising
  // home, so Go home on a phone returns the real camera home even when the PC or another
  // phone moved it.
  const sharedListeners = new Set();
  let sharedTimer = null;
  let lastStatus = { text: '', error: false, at: 0, from: '' };
  const remote = { synced: false, statusAt: null, syncAskedAt: 0 };

  function sharedState() {
    return { ...tracker.exportShared(Date.now()), status: { ...lastStatus } };
  }

  function sharedChanged() {
    if (!sharedListeners.size || sharedTimer) return;
    sharedTimer = setTimeout(() => {
      sharedTimer = null;
      const state = sharedState();
      for (const listener of sharedListeners) {
        try {
          listener(state);
        } catch (error) {
          console.error(error);
        }
      }
    }, 60);
  }

  function save() {
    store.tracker = tracker.snapshot();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      // storage full / private mode: keep working in memory
    }
    sharedChanged();
  }

  // ------------------------------------------------------------------ helpers

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // `from`: the device that asked for this (a phone controlling through this console), shown
  // first in its own element so the message itself is still translated.
  function status(text, isError, from) {
    lastStatus = { text: String(text || ''), error: !!isError, at: Date.now(), from: from ? String(from) : '' };
    sharedChanged();
    const line = $('ptz-status');
    if (!line) return;
    if (from) {
      const who = document.createElement('strong');
      who.className = 'ptz-status-from';
      who.textContent = from;
      line.replaceChildren(who, document.createTextNode(' '), document.createTextNode(text));
    } else {
      line.textContent = text;
    }
    line.dataset.state = isError ? 'error' : 'ok';
  }

  function connected() {
    return api.getStatus().connected;
  }

  function remoteControl() {
    return window.AirizRemoteControl || null;
  }

  // This console controls the AIRIZ through another console ("Remote control by code").
  function viaRemote() {
    const control = remoteControl();
    return !!(control && typeof control.isRemote === 'function' && control.isRemote());
  }

  // The console with the cable shares its camera (AIRIZ Console 1.11.1+, link protocol 4).
  function hostShares() {
    const control = remoteControl();
    const peer = control && control.ptzPeer;
    return !!(peer && peer.pcVersion >= 4);
  }

  const ASK_TEXT = {
    'go-home': 'Asked the PC to move the camera home\u2026',
    'set-home': 'Asked the PC to set Home here\u2026',
    'set-limit': 'Asked the PC to save the soft limit\u2026',
    'clear-limits': 'Asked the PC to clear the soft limits\u2026',
    'find-rising-home': 'Asked the PC to lower the camera to the bottom\u2026',
    'read-switch': 'Asked the PC to read the rising switch\u2026'
  };
  const OLD_HOST_NOTE = 'The PC runs an older AIRIZ Console that does not share the camera position, so only the moves sent from this device were counted. Update the AIRIZ Console on the PC.';

  // On a controller these actions run on the console with the cable, which knows every move.
  function askHost(action, args) {
    if (!viaRemote() || !hostShares()) return false;
    const control = remoteControl();
    if (!control || typeof control.sendPtzAction !== 'function' || !control.sendPtzAction(action, args || {})) return false;
    status(ASK_TEXT[action] || 'Asked the PC\u2026');
    return true;
  }

  // A controller takes over the camera tracked by the console with the cable.
  function applyHostState(state, receivedAt) {
    if (!viaRemote() || !tracker.adoptShared(state, Number(receivedAt) || Date.now())) return false;
    const first = !remote.synced;
    remote.synced = true;
    save();
    renderPosition();
    animatePose();
    const hostStatus = state.status;
    if (hostStatus && hostStatus.text && hostStatus.at !== remote.statusAt) {
      remote.statusAt = hostStatus.at;
      // Only messages from now on; not an old one from before this device connected.
      if (!first) status(hostStatus.text, hostStatus.error, 'PC');
    }
    return true;
  }

  // Send a command and wait for its "#INFO#...#END#" answer (sensors, switches).
  function query(command, timeoutMs = 2500, sendOptions) {
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
      api.sendCommand(command, sendOptions).then(sent => {
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

  async function runMoves(moves, token, from) {
    for (const move of moves) {
      if (!(await waitIdle(token))) return false;
      const delta = tracker.clampDelta(move.axis, move.delta);
      const command = core.motorCommand(move.axis, delta, store.speeds[move.axis]);
      if (!command) continue;
      const sent = await api.sendCommand(command);
      if (!sent) {
        status('Motor command not sent. Check the connection and the console.', true, from);
        return false;
      }
    }
    return waitIdle(token);
  }

  async function moveTo(target, label, from) {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true, from);
      return false;
    }
    const moves = core.planMove(tracker, target);
    if (!moves.length) {
      status(label ? label + ': already there.' : 'Already there.', false, from);
      return true;
    }
    const token = newOperation();
    status((label ? 'Moving to ' + label : 'Moving') + '\u2026', false, from);
    const ok = await runMoves(moves, token, from);
    if (ok) {
      const clipped = moves.some(move => move.clipped);
      status((label ? 'At ' + label : 'Move finished') + (clipped ? ' (stopped at a soft limit).' : '.'), false, from);
    }
    return ok;
  }

  // Go home. When Home is fully down the bottom switch confirms it (1.11.1): if the tracked
  // height was off (an interrupted move, a move made outside this console), keep lowering
  // in small steps until the switch is pressed.
  async function goHome(from) {
    const home = tracker.home;
    const ok = await moveTo(home, 'home', from);
    if (!ok || !tracker.risingRef || home.rising > 0 || !connected() || findingHome) return ok;
    findingHome = true;
    try {
      const pressed = await readSwitch(true);
      if (pressed !== false) return true;
      status('Not fully down yet: lowering until the bottom switch is pressed\u2026', false, from);
      const moved = await findRisingHome(newOperation(), 60, 1800, from);
      if (moved === null) return false;
      status('At home: lowered ' + moved + ' more steps until the bottom switch was pressed.', false, from);
      return true;
    } finally {
      findingHome = false;
    }
  }

  // ------------------------------------------------------------------ position UI

  function renderPosition() {
    renderPose(true);
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
    // (Not while lowering to the bottom switch: the counted height is wrong then, the
    // search reports by itself.)
    if (result.type === 'move' && result.move.axis === 'rising' && result.saturated && !findingHome) {
      status(result.to === 0
        ? 'The camera reaches the bottom end stop: rising = 0 (fully down).'
        : 'The camera reaches the top end stop: rising = ' + result.to + ' (fully up).');
    }
    // A move that should end fully down is checked against the real bottom switch.
    if (result.type === 'move' && result.move.axis === 'rising' && result.to === 0 && tracker.risingRef) {
      scheduleBottomCheck(tracker.busyUntil() - Date.now() + 400);
    }
    save();
    renderPosition();
    animatePose();
  });


  // ------------------------------------------------------------------ camera position view
  // Side view = rising height (0 = fully down on the bottom switch, full travel = fully up),
  // top view = pan angle from Home. Animated from the real move timing while a motor runs.
  const pose = {
    side: $('ptz-pose-side'),
    mast: $('ptz-pose-mast'),
    head: $('ptz-pose-head'),
    arrow: $('ptz-pose-arrow'),
    animating: false,
    lastTextAt: 0
  };
  const HEAD_DOWN_Y = 106;
  const HEAD_UP_Y = 20;

  function setText(id, text) {
    const element = $(id);
    if (element && element.textContent !== text) element.textContent = text;
  }

  function renderPose(force) {
    if (!pose.side) return;
    const now = Date.now();
    const live = tracker.livePosition(now);
    const travel = tracker.travel;
    const info = core.describePose(live, { travel, risingRef: tracker.risingRef });
    // Without the bottom-switch reference the height is drawn from the counted steps, greyed out.
    const fraction = info.heightFraction !== null
      ? info.heightFraction
      : Math.min(1, Math.max(0, live.rising / travel.risingMax));
    const headY = HEAD_DOWN_Y - fraction * (HEAD_DOWN_Y - HEAD_UP_Y);
    pose.head.setAttribute('transform', 'translate(0 ' + headY.toFixed(1) + ')');
    pose.mast.setAttribute('y', (headY + 20).toFixed(1));
    pose.mast.setAttribute('height', Math.max(0, 116 - (headY + 20)).toFixed(1));
    pose.side.classList.toggle('ptz-pose-unknown', !tracker.risingRef);
    // SVG rotation is clockwise; pan forward turns counter-clockwise.
    pose.arrow.setAttribute('transform', 'rotate(' + (-info.panDegrees).toFixed(1) + ')');
    $('ptz-pose').dataset.moving = now < tracker.busyUntil() ? 'true' : 'false';

    // Text: at most 10 updates per second while moving.
    if (!force && now - pose.lastTextAt < 100) return;
    pose.lastTextAt = now;
    setText('ptz-pose-height', info.heightLabel);
    setText('ptz-pose-height-steps', tracker.risingRef
      ? live.rising + ' / ' + travel.risingMax + ' steps'
      : live.rising + ' steps (not referenced)');
    setText('ptz-pose-pan', info.panLabel);
    const signed = (live.pan > 0 ? '+' : '') + live.pan;
    const turns = Math.abs(info.panTurns);
    setText('ptz-pose-pan-steps', turns >= 1
      ? signed + ' steps (' + (Math.round(turns * 10) / 10) + ' turns)'
      : signed + ' steps');
    let note = 'Height counts from the bottom switch (0) up to full travel; pan 0 = Home.';
    if (!tracker.risingRef) {
      note = 'Height unknown: press Lower to bottom & reset height (Position group).';
    } else if (tracker.uncertain) {
      note = 'Estimated after an interrupted move: press Lower to bottom & reset height, then Set home again.';
    }
    setText('ptz-pose-note', note);
  }

  function animatePose() {
    renderPose(true);
    if (pose.animating) return;
    pose.animating = true;
    const frame = () => {
      const moving = Date.now() < tracker.busyUntil();
      renderPose(!moving);
      if (moving) {
        requestAnimationFrame(frame);
      } else {
        pose.animating = false;
        renderPose(true);
      }
    };
    requestAnimationFrame(frame);
  }

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
  // 1.11.3: zone editing - the zones when "Draw zones" was opened (Cancel brings them back)
  let zonesBeforeEdit = null;
  const ZONE_HANDLE_PX = 20;   // size of the delete (x) square on a zone, CSS pixels
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
    store.zones.forEach((zone, index) => {
      const box = rectOf(zone);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillRect(...box);
      ctx.strokeRect(...box);
      // zone number (matches "Zone 1..4" in Smart detection)
      ctx.font = 'bold ' + Math.round(12 * ratio) + 'px sans-serif';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillRect(box[0], box[1], 18 * ratio, 18 * ratio);
      ctx.fillStyle = '#0d1117';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), box[0] + 9 * ratio, box[1] + 9 * ratio);
      if (view.mode === 'zones') {
        // delete handle (x) in the top right corner
        const handle = zoneHandleRect(index);
        if (handle) {
          const hx = handle.left * ratio;
          const hy = handle.top * ratio;
          const size = ZONE_HANDLE_PX * ratio;
          ctx.fillStyle = 'rgba(239, 68, 68, 0.92)';
          ctx.fillRect(hx, hy, size, size);
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(hx + size * 0.3, hy + size * 0.3);
          ctx.lineTo(hx + size * 0.7, hy + size * 0.7);
          ctx.moveTo(hx + size * 0.7, hy + size * 0.3);
          ctx.lineTo(hx + size * 0.3, hy + size * 0.7);
          ctx.stroke();
        }
      }
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
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

  // Delete (x) square of zone `index` in CSS pixels of the stage, or null when it is off screen.
  function zoneHandleRect(index) {
    const zone = store.zones[index];
    if (!zone) return null;
    const a = frameToStage(zone.x, zone.y);
    const b = frameToStage(zone.x + zone.w, zone.y + zone.h);
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const right = Math.min(b.x, 1) * width;
    const top = Math.max(a.y, 0) * height;
    if (right <= 0 || top >= height || b.y <= 0 || a.x >= 1) return null;
    const left = Math.max(a.x * width, right - ZONE_HANDLE_PX);
    return { left, top, right: left + ZONE_HANDLE_PX, bottom: top + ZONE_HANDLE_PX };
  }

  function zoneHandleAt(event) {
    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (let i = store.zones.length - 1; i >= 0; i--) {
      const handle = zoneHandleRect(i);
      if (handle && x >= handle.left && x <= handle.right && y >= handle.top && y <= handle.bottom) return i;
    }
    return -1;
  }

  function zonesChanged() {
    save();
    renderZones();
    resetDetection();
    drawOverlay();
  }

  function deleteZone(index) {
    if (index < 0 || index >= store.zones.length) return;
    store.zones = core.removeZone(store.zones, index);
    zonesChanged();
    status('Zone ' + (index + 1) + ' deleted.');
  }

  // Esc, right-click or a lost pointer: the box being drawn is dropped, nothing is saved.
  function cancelDraft(say) {
    if (!draftZone && !(pointer && view.mode === 'zones')) return false;
    if (pointer && pointer.id !== undefined && overlay.hasPointerCapture && overlay.hasPointerCapture(pointer.id)) {
      overlay.releasePointerCapture(pointer.id);
    }
    pointer = null;
    draftZone = null;
    drawOverlay();
    if (say) status('Zone drawing cancelled.');
    return true;
  }

  overlay.addEventListener('pointerdown', event => {
    if (!liveStream) return;
    if (view.mode === 'zones') {
      if (event.button !== 0) {
        cancelDraft(true);
        return;
      }
      const handle = zoneHandleAt(event);
      if (handle < 0 && store.zones.length >= core.MAX_ZONES) {
        status('Up to 4 zones: delete one first (\u00d7 on the zone, or in the list under Smart detection).', true);
        return;
      }
      overlay.setPointerCapture(event.pointerId);
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, start: frameFromEvent(event), cx: view.cx, cy: view.cy, moved: false, deleteIndex: handle };
      return;
    }
    overlay.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, start: frameFromEvent(event), cx: view.cx, cy: view.cy, moved: false };
  });
  overlay.addEventListener('contextmenu', event => {
    if (view.mode !== 'zones') return;
    event.preventDefault();
    cancelDraft(true);
  });
  overlay.addEventListener('pointercancel', () => cancelDraft(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && view.mode === 'zones') cancelDraft(true);
  });
  overlay.addEventListener('pointermove', event => {
    if (!pointer) {
      if (view.mode === 'zones') overlay.style.cursor = zoneHandleAt(event) >= 0 ? 'pointer' : 'crosshair';
      return;
    }
    // right button pressed while drawing (a chorded press gives no new pointerdown): cancel the box
    if (view.mode === 'zones' && (event.buttons & 2)) {
      cancelDraft(true);
      return;
    }
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) pointer.moved = true;
    if (!pointer.moved) return;
    if (view.mode === 'zones') {
      if (pointer.deleteIndex >= 0) return;   // started on a delete square: no drawing
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
    const deleteIndex = pointer.deleteIndex;
    pointer = null;
    if (view.mode === 'zones') {
      if (deleteIndex >= 0 && !wasMoved) {
        draftZone = null;
        deleteZone(deleteIndex);
        return;
      }
      const added = draftZone ? core.addZone(store.zones, draftZone) : null;
      draftZone = null;
      if (added) {
        store.zones = added;
        zonesChanged();
        status('Zone ' + added.length + ' added. Only motion inside the zones counts.');
      } else {
        drawOverlay();
      }
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
  // 1.11.7: acts at once like the Motor control jog pad. A press no longer waits for the
  // time model to say the previous move is over (a move still running is stopped first),
  // and a release always sends the stop: the model only estimates the motor speed, and a
  // skipped stop let the camera run on to the end of the long hold move.
  let hold = null;
  async function startHold(button) {
    if (!connected() || hold) return;
    const [axis, direction] = button.dataset.hold.split(':');
    const delta = tracker.clampDelta(axis, Number(direction) * HOLD_MAX_STEPS);
    if (!delta) {
      status('Soft limit reached on ' + axis + '.', true);
      return;
    }
    stopScan();
    newOperation();
    const current = { button, released: false, sending: false, sent: false };
    hold = current;
    button.classList.add('ptz-holding');
    if (Date.now() < tracker.busyUntil()) await api.stopMotor();
    if (current.released) return;
    const command = core.motorCommand(axis, tracker.clampDelta(axis, Number(direction) * HOLD_MAX_STEPS), store.speeds[axis]);
    if (!command) return;
    current.sending = true;
    const sent = await api.sendCommand(command);
    current.sending = false;
    current.sent = !!sent;
    if (!sent) {
      status('Motor command not sent. Check the connection and the console.', true);
      return;
    }
    // Let go while the move was being written: stop it now.
    if (current.released) api.stopMotor();
  }
  function endHold() {
    if (!hold) return;
    const current = hold;
    hold = null;
    current.released = true;
    current.button.classList.remove('ptz-holding');
    if (current.sent) api.stopMotor();
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
    const wasZones = view.mode === 'zones';
    if (wasZones && mode !== 'zones') {
      cancelDraft(false);
      zonesBeforeEdit = null;
    }
    if (mode === 'zones' && !wasZones) zonesBeforeEdit = store.zones.map(zone => ({ ...zone }));
    view.mode = mode;
    document.querySelectorAll('[data-ptz-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.ptzMode === mode));
    });
    stage.dataset.mode = mode;
    overlay.style.cursor = mode === 'zones' ? 'crosshair' : '';
    $('ptz-zones-edit').hidden = mode !== 'zones';
    $('ptz-hint').textContent = mode === 'zones'
      ? 'Zones tell Smart detection where to look: only motion inside a box counts. Drag to draw a box (up to 4), click the \u00d7 on a box to delete it, Esc or right-click cancels the box you are drawing.'
      : 'Click the picture to center that spot. Hold an arrow to move, release to stop. Wheel = digital zoom, drag = look around when zoomed.';
    drawOverlay();
  }
  $('ptz-zones-done').addEventListener('click', () => {
    setMode('move');
    status(store.zones.length ? 'Zones saved: Smart detection watches ' + store.zones.length + ' zone' + (store.zones.length > 1 ? 's' : '') + '.'
      : 'No zones: Smart detection watches the whole picture.');
  });
  $('ptz-zones-cancel').addEventListener('click', () => {
    const before = zonesBeforeEdit;
    setMode('move');
    if (before && JSON.stringify(before) !== JSON.stringify(store.zones)) {
      store.zones = before;
      zonesChanged();
    }
    status('Zone changes cancelled.');
  });
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

  function setHomeHere(from) {
    tracker.setHome();
    save();
    renderPosition();
    status('Home set here. Positions are now counted from this point.', false, from);
  }
  $('ptz-set-home').addEventListener('click', () => {
    if (askHost('set-home')) return;
    setHomeHere();
  });
  $('ptz-go-home').addEventListener('click', async () => {
    if (askHost('go-home')) return;
    stopScan();
    const ok = await goHome();
    if (ok && viaRemote() && !hostShares()) status(OLD_HOST_NOTE, true);
  });
  function setLimitHere(axis, side, from) {
    tracker.setLimit(axis, side, tracker.position[axis]);
    save();
    renderPosition();
    status('Soft limit saved: ' + axis + ' ' + side + ' = ' + tracker.position[axis] + '. Moves from this console stop there.', false, from);
  }
  document.querySelectorAll('[data-limit]').forEach(button => button.addEventListener('click', () => {
    const [axis, side] = button.dataset.limit.split(':');
    if (askHost('set-limit', { axis, side })) return;
    setLimitHere(axis, side);
  }));
  function clearLimits(from) {
    for (const axis of core.AXES) {
      tracker.setLimit(axis, 'min', null);
      tracker.setLimit(axis, 'max', null);
    }
    save();
    renderPosition();
    status('Soft limits cleared.', false, from);
  }
  $('ptz-clear-limits').addEventListener('click', () => {
    if (askHost('clear-limits')) return;
    clearLimits();
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

  // Reads the bottom (rising-detect) switch and keeps the tracked height in step with it:
  // pressed = the real camera is fully down, so rising becomes 0.
  // background = automatic check: not echoed as a command line in the console.
  async function readSwitch(background) {
    const info = await query('diag button get rising-det', 2500, background ? { quiet: true } : undefined);
    const pressed = core.parseSwitchState(info, store.switchPressedValue);
    if (pressed === null) {
      $('ptz-switch-state').textContent = info
        ? 'The bottom switch gave an unexpected answer (' + info.value + '). Check "Bottom switch reads, when pressed" under Calibration > Advanced numbers.'
        : 'The bottom switch did not answer. Check the connection and try again.';
      return null;
    }
    $('ptz-switch-state').textContent = pressed
      ? 'Yes: the camera is fully down (bottom switch pressed).'
      : 'No: the camera is above the bottom (bottom switch not pressed).';
    if (pressed && Date.now() >= tracker.busyUntil()) {
      const wasReferenced = tracker.risingRef;
      const correction = tracker.setRisingReference();
      if (wasReferenced && Math.abs(correction) >= 5) {
        status('Bottom switch pressed: height corrected by ' + correction + ' steps (now fully down).');
      }
      save();
      renderPosition();
    } else if (!pressed && tracker.risingRef && tracker.position.rising <= 0 && Date.now() >= tracker.busyUntil()) {
      tracker.markUncertain();
      status('The bottom switch is not pressed although the camera should be fully down: height estimated. Press Lower to bottom & reset height.', true);
      save();
      renderPosition();
    }
    return pressed;
  }

  // Verify "fully down" with the real switch after a move (skipped while a macro runs).
  let bottomCheckTimer = null;
  let findingHome = false;
  function scheduleBottomCheck(delayMs) {
    clearTimeout(bottomCheckTimer);
    bottomCheckTimer = setTimeout(() => {
      if (findingHome || !connected() || api.getStatus().macroRunning) return;
      // A controller leaves this to the console with the cable, which shares the result.
      if (viaRemote() && hostShares()) return;
      if (Date.now() < tracker.busyUntil()) {
        scheduleBottomCheck(tracker.busyUntil() - Date.now() + 400);
        return;
      }
      if (tracker.risingRef && tracker.position.rising === 0) readSwitch(true);
    }, Math.max(200, delayMs));
  }

  // On connect: one switch reading tells whether the camera starts fully down. A controller
  // takes over the camera tracked by the console with the cable instead (1.11.1).
  let wasConnected = false;
  setInterval(() => {
    const isConnected = connected();
    if (isConnected && !wasConnected) {
      setTimeout(() => {
        if (!connected() || api.getStatus().macroRunning || findingHome) return;
        if (viaRemote() && hostShares()) return;
        readSwitch(true);
      }, 1200);
    }
    wasConnected = isConnected;
    if (!isConnected || !viaRemote()) {
      remote.synced = false;
      remote.statusAt = null;
    } else if (!remote.synced) {
      const control = remoteControl();
      const latest = control && control.ptzState;
      if (latest && latest.state) {
        applyHostState(latest.state, latest.at);
      } else if (hostShares() && control && typeof control.sendPtzAction === 'function'
        && Date.now() - remote.syncAskedAt > 5000) {
        remote.syncAskedAt = Date.now();
        control.sendPtzAction('sync', {});
      }
    }
  }, 1000);
  $('ptz-read-switch').addEventListener('click', () => {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return;
    }
    if (askHost('read-switch')) return;
    readSwitch();
  });

  // Lower the camera in small steps until the rising switch reports "pressed",
  // then make that the rising zero and the lowest soft limit.
  async function findRisingHomeAction(from) {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true, from);
      return;
    }
    stopScan();
    const token = newOperation();
    status('Lowering slowly until the camera touches the bottom switch\u2026', false, from);
    findingHome = true;
    try {
      const moved = await findRisingHome(token, 60, 1800, from);
      if (moved !== null) {
        status('Bottom found after ' + moved + ' steps down: height is now 0 (fully down).', false, from);
      }
    } finally {
      findingHome = false;
    }
  }
  $('ptz-find-rising-home').addEventListener('click', () => {
    if (askHost('find-rising-home')) return;
    findRisingHomeAction();
  });

  // Lower in `chunk` steps until the rising switch is pressed. Returns the steps lowered, or
  // null (stopped by a newer action, no answer from the switch, not found).
  async function findRisingHome(token, chunk, maxTotal, from) {
    let moved = 0;
    while (moved <= maxTotal) {
      if (token !== operation) return null;
      const pressed = await readSwitch();
      if (pressed === null) {
        status('The bottom switch did not answer, so the bottom was not found. Check the connection and try again.', true, from);
        return null;
      }
      if (pressed) {
        tracker.setRisingReference();
        save();
        renderPosition();
        return moved;
      }
      const sent = await api.sendCommand(core.motorCommand('rising', -chunk, store.speeds.rising));
      if (!sent) return null;
      moved += chunk;
      if (!(await waitIdle(token))) return null;
      await sleep(150);
    }
    status('Lowered ' + maxTotal + ' steps without reaching the bottom switch. If the camera is already at the bottom, change "Bottom switch reads, when pressed" under Calibration > Advanced numbers.', true, from);
    return null;
  }

  $('ptz-privacy-on').addEventListener('click', async () => {
    if (!connected()) {
      status('Connect the AIRIZ first (USB, or Try demo).', true);
      return;
    }
    const softLowest = tracker.limits.rising.min;
    const lowest = Number.isFinite(softLowest) ? softLowest : (tracker.risingRef ? 0 : null);
    if (!Number.isFinite(lowest)) {
      status('Set the lowest position first: press "Lower to bottom & reset height", or lower the camera and press "Set lowest".', true);
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
    // 1.11.8: the Windows app keeps a minimized window working while detection is armed.
    if (window.airizDesktop && typeof window.airizDesktop.setBackgroundWork === 'function') {
      window.airizDesktop.setBackgroundWork(detection.armed).catch(() => {});
    }
    // 1.11.11: Start / Stop buttons (live-view toolbar and Smart detection) and the badge on the picture.
    for (const button of document.querySelectorAll('[data-detect-toggle]')) {
      button.textContent = detection.armed ? 'Stop smart detection' : 'Start smart detection';
      button.setAttribute('aria-pressed', String(detection.armed));
      button.classList.toggle('btn-danger', detection.armed);
      button.classList.toggle('btn-primary', !detection.armed);
    }
    $('ptz-detect-badge').hidden = !detection.armed;
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
    const list = $('ptz-zones-list');
    list.replaceChildren(...store.zones.map((zone, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm ptz-zone-chip';
      button.dataset.zone = String(index);
      button.setAttribute('aria-label', 'Delete zone ' + (index + 1));
      button.title = 'Delete zone ' + (index + 1);
      const label = document.createElement('span');
      label.textContent = 'Zone ' + (index + 1);
      const cross = document.createElement('span');
      cross.className = 'ptz-zone-x';
      cross.setAttribute('aria-hidden', 'true');
      cross.textContent = '\u00d7';
      button.append(label, cross);
      button.addEventListener('click', () => deleteZone(index));
      return button;
    }));
    $('ptz-zones-clear').disabled = !store.zones.length;
  }

  function stopTracking() {
    detection.trackedAway = false;
  }

  function analyse() {
    // 1.11.8: also while the window is minimized or hidden (alerts matter most then).
    if (!liveStream || !video.videoWidth) return;
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
    const wait = Math.max(5, Number(store.detect.trackReturn) || 30) * 1000;
    const due = core.trackingReturnDue({
      trackedAway: detection.trackedAway,
      armed: detection.armed,
      track: store.detect.track,
      lastMotionAt: detection.lastMotionAt,
      waitMs: wait,
      busyUntil: tracker.busyUntil(),
      now
    });
    if (!due) return;
    detection.trackedAway = false;
    const target = tracker.homed ? tracker.home : detection.anchor;
    if (target) {
      renderDetectStatus('No motion for ' + Math.round(wait / 1000) + ' s: returning.');
      (tracker.homed ? goHome() : moveTo(target, 'the start position')).then(resetDetection);
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
        const thumbButton = document.createElement('button');
        thumbButton.type = 'button';
        thumbButton.className = 'ptz-event-thumb';
        thumbButton.title = 'View';
        thumbButton.addEventListener('click', () => openViewer(event, 'photo'));
        const image = document.createElement('img');
        image.src = event.thumb;
        image.alt = 'Motion at ' + event.at.toLocaleTimeString();
        thumbButton.append(image);
        item.append(thumbButton);
      }
      const text = document.createElement('div');
      const time = document.createElement('strong');
      time.textContent = event.at.toLocaleTimeString();
      text.append(time, document.createTextNode(' \u00b7 ' + (event.fraction * 100).toFixed(1) + '%'));
      const links = document.createElement('div');
      links.className = 'ptz-event-links';
      // 1.11.13: View opens the picture inside the console; nothing is saved unless you press Save there.
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'btn btn-sm';
      view.dataset.eventView = '';
      view.textContent = 'View';
      view.addEventListener('click', () => openViewer(event, 'photo'));
      links.append(view);
      if (event.clip) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn btn-sm';
        play.dataset.eventClip = '';
        play.textContent = 'Play clip';
        play.addEventListener('click', () => openViewer(event, 'clip'));
        links.append(play);
      }
      text.append(links);
      if (event.alerts && event.alerts.length) {
        const alerts = document.createElement('div');
        alerts.className = 'ptz-event-alerts';
        for (const alert of event.alerts) {
          const part = document.createElement('span');
          part.className = alert.ok === true ? 'ok' : alert.ok === false ? 'fail' : '';
          part.textContent = (alert.channel === 'Teams' ? 'Ziris PTB chat' : 'Desktop') + ': ' + alert.note;
          alerts.append(part);
        }
        text.append(alerts);
      }
      item.append(text);
      return item;
    }));
    renderViewer();
  }

  // ------------------------------------------------------------------ event viewer (1.11.13)
  // Look at a motion event without saving it: the full photo (or the clip) opens inside the console.
  // Saving is a separate, explicit button in the viewer. Events still live in memory only.
  // The viewer markup sits at the end of the page (after this script), so it is wired up on first use.
  const viewer = { event: null, mode: 'photo', bound: false };

  function eventFileName(event, extension) {
    return 'airiz-motion-' + event.at.toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.' + extension;
  }

  function openViewer(event, mode) {
    if (!detection.events.includes(event)) return;
    bindViewer();
    viewer.event = event;
    viewer.mode = mode === 'clip' && event.clip ? 'clip' : 'photo';
    renderViewer();
    const dialog = $('ptz-viewer');
    if (!dialog.open) dialog.showModal();
  }

  function closeViewer() {
    const dialog = $('ptz-viewer');
    if (!dialog) return;
    const video = $('ptz-viewer-video');
    video.pause();
    video.removeAttribute('src');
    video.load();
    viewer.event = null;
    if (dialog.open) dialog.close();
  }

  // The list is newest first: "older" is further down the list.
  function stepViewer(delta) {
    const index = detection.events.indexOf(viewer.event);
    const next = detection.events[index + delta];
    if (index < 0 || !next) return;
    viewer.event = next;
    viewer.mode = 'photo';
    renderViewer();
  }

  function renderViewer() {
    const dialog = $('ptz-viewer');
    if (!dialog || !viewer.event) return;
    const event = viewer.event;
    const index = detection.events.indexOf(event);
    if (index < 0) {
      closeViewer();
      return;
    }
    const image = $('ptz-viewer-image');
    const video = $('ptz-viewer-video');
    const showClip = viewer.mode === 'clip' && !!event.clip;
    image.hidden = showClip;
    video.hidden = !showClip;
    if (showClip) {
      if (video.getAttribute('src') !== event.clip) video.src = event.clip;
    } else {
      if (video.getAttribute('src')) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      const source = event.photo || event.thumb;
      if (image.getAttribute('src') !== source) image.src = source;
      image.alt = 'Motion at ' + event.at.toLocaleTimeString();
    }
    $('ptz-viewer-title').textContent = event.at.toLocaleTimeString() + ' \u00b7 ' + (event.fraction * 100).toFixed(1) + '%';
    $('ptz-viewer-count').textContent = (index + 1) + ' / ' + detection.events.length;
    $('ptz-viewer-newer').disabled = index === 0;
    $('ptz-viewer-older').disabled = index === detection.events.length - 1;
    const mode = $('ptz-viewer-mode');
    mode.hidden = !event.clip;
    mode.textContent = showClip ? 'Show photo' : 'Play clip';
    const savePhoto = $('ptz-viewer-save-photo');
    const photo = event.photo || event.thumb;
    savePhoto.hidden = !photo;
    if (photo) {
      savePhoto.href = photo;
      savePhoto.download = eventFileName(event, 'jpg');
    }
    const saveClip = $('ptz-viewer-save-clip');
    saveClip.hidden = !event.clip;
    if (event.clip) {
      saveClip.href = event.clip;
      saveClip.download = eventFileName(event, 'webm');
    }
  }

  function bindViewer() {
    const dialog = $('ptz-viewer');
    if (!dialog || viewer.bound) return;
    viewer.bound = true;
    $('ptz-viewer-close').addEventListener('click', closeViewer);
    $('ptz-viewer-older').addEventListener('click', () => stepViewer(1));
    $('ptz-viewer-newer').addEventListener('click', () => stepViewer(-1));
    $('ptz-viewer-mode').addEventListener('click', () => {
      viewer.mode = viewer.mode === 'clip' ? 'photo' : 'clip';
      renderViewer();
    });
    dialog.addEventListener('close', () => {
      if (viewer.event) closeViewer();
    });
    // A click on the dark area around the picture closes the viewer.
    dialog.addEventListener('click', clickEvent => {
      if (clickEvent.target === dialog) closeViewer();
    });
    // Arrow keys follow the buttons: left = older, right = newer (not while the clip player has focus).
    // Listen on the page: a button that just became disabled drops the focus out of the dialog.
    document.addEventListener('keydown', keyEvent => {
      if (!dialog.open || (keyEvent.target && keyEvent.target.tagName === 'VIDEO')) return;
      if (keyEvent.key === 'ArrowLeft') stepViewer(1);
      if (keyEvent.key === 'ArrowRight') stepViewer(-1);
    });
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
      }, durationSetting('spotSeconds', settings.spotSeconds) * 1000);
    }
    if (settings.siren && !siren.active) startSiren(store.sirenSeconds);
    if (settings.clip) recordClip(event, durationSetting('clipSeconds', settings.clipSeconds));
    // 1.11.8: every alert reports back; the event list shows whether it went out.
    event.alerts = [];
    if (settings.notify) {
      const shown = showDesktopAlert('AIRIZ motion', 'Motion at ' + event.at.toLocaleTimeString(), event.thumb);
      event.alerts.push({ channel: 'Desktop', ok: shown.ok, note: shown.note });
      if (!shown.ok) renderAlertStatus('Desktop notification: ' + shown.note);
    }
    if (settings.teams) {
      const entry = { channel: 'Teams', ok: null, note: 'sending\u2026' };
      event.alerts.push(entry);
      const wait = TEAMS_COOLDOWN_MS - (Date.now() - detection.lastTeamsAt);
      if (!window.AirizTeam || !window.AirizTeam.member) {
        entry.ok = false;
        entry.note = 'Join Ziris PTB on the Team page first.';
        renderAlertStatus('Ziris PTB chat: ' + entry.note);
      } else if (wait > 0) {
        entry.ok = false;
        entry.note = 'skipped (at most one chat alert every 2 minutes)';
      } else {
        detection.lastTeamsAt = Date.now();
        window.AirizTeam.postAlert({
          title: 'AIRIZ motion alert',
          text: 'Motion detected by the AIRIZ camera at ' + event.at.toLocaleTimeString() + ' ('
            + (event.fraction * 100).toFixed(1) + '% of the watched area).'
        }).then(result => {
          entry.ok = !!result.ok;
          entry.note = result.ok ? 'sent' : result.error;
          if (!result.ok) renderAlertStatus('Ziris PTB chat: not sent. ' + result.error);
          renderEvents();
        });
      }
    }
    renderEvents();
  }

  // Desktop notification (Windows toast). Returns { ok, note }.
  function showDesktopAlert(title, body, thumb) {
    if (!('Notification' in window)) return { ok: false, note: 'this browser has no desktop notifications.' };
    if (Notification.permission === 'denied') {
      return { ok: false, note: 'blocked for this page. Allow notifications in the browser site settings (lock icon left of the address).' };
    }
    if (Notification.permission !== 'granted') {
      return { ok: false, note: 'not allowed yet. Tick Desktop notification again and choose Allow.' };
    }
    try {
      const desktop = !!window.airizDesktop;
      const note = new Notification(title, { body, icon: desktop || !thumb ? 'icons/icon-192.png' : thumb, tag: 'airiz-motion', silent: false });
      // Clicking the pop-up brings the console to the front (optional: never blocks the alert).
      if (typeof note.addEventListener === 'function') {
        note.addEventListener('click', () => {
          window.focus();
          note.close();
        });
      }
    } catch {
      return { ok: false, note: 'Windows refused the notification.' };
    }
    // The Windows app also flashes its taskbar button while the window is not in front.
    if (window.airizDesktop && typeof window.airizDesktop.requestAttention === 'function' && (document.hidden || !document.hasFocus())) {
      window.airizDesktop.requestAttention(true).catch(() => {});
    }
    return { ok: true, note: 'shown' };
  }

  // One line per alert channel (each line is translated on its own).
  function renderAlertStatus(text) {
    const box = $('ptz-alert-status');
    box.replaceChildren(...String(text || '').split('\n').filter(Boolean).map(line => {
      const row = document.createElement('div');
      row.textContent = line;
      return row;
    }));
  }

  // "Send a test alert": both alerts at once, no motion and no 2-minute pause needed.
  async function testAlerts() {
    const settings = store.detect;
    if (!settings.notify && !settings.teams) {
      renderAlertStatus('Tick Desktop notification and/or Alert the Ziris PTB chat first.');
      return;
    }
    const lines = [];
    if (settings.notify) {
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      const shown = showDesktopAlert('AIRIZ test alert', 'This is how a motion alert looks.', '');
      lines.push(shown.ok
        ? 'Desktop notification: shown. No pop-up seen? Turn on Windows notifications for this app: Settings > System > Notifications.'
        : 'Desktop notification: ' + shown.note);
    }
    if (settings.teams) {
      if (!window.AirizTeam || !window.AirizTeam.member) {
        lines.push('Ziris PTB chat: join Ziris PTB on the Team page first.');
      } else {
        renderAlertStatus(lines.concat('Ziris PTB chat: sending\u2026').join('\n'));
        const result = await window.AirizTeam.postAlert({
          title: 'AIRIZ test alert',
          text: 'Test from the AIRIZ console: motion alerts reach this chat.'
        });
        lines.push(result.ok ? 'Ziris PTB chat: sent. Check the chat.' : 'Ziris PTB chat: not sent. ' + result.error);
      }
    }
    renderAlertStatus(lines.join('\n'));
  }
  $('ptz-test-alerts').addEventListener('click', testAlerts);

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
  // 1.11.8: or the user's own sound file. It goes to the AIRIZ like a voice message (talk.wav)
  // the first time, then every repeat plays that file again.
  const SIREN_SOUND_KEY = 'airiz.siren.sound.v1';
  const SIREN_RATE = 16000;
  const SIREN_MAX_SECONDS = 15;
  const TALK_FILE = '/tmp/airiz/talk.wav';
  const siren = { active: false, timer: null, until: 0 };
  let sirenSound = loadSirenSound();
  let sirenMessage = null;

  function loadSirenSound() {
    try {
      const saved = JSON.parse(localStorage.getItem(SIREN_SOUND_KEY) || 'null');
      return saved && saved.pcm && saved.name ? saved : null;
    } catch {
      return null;
    }
  }

  function sirenSamples() {
    if (!sirenSound) return null;
    const bytes = Uint8Array.from(atob(sirenSound.pcm), char => char.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    const samples = new Float32Array(pcm.length);
    for (let index = 0; index < pcm.length; index += 1) samples[index] = pcm[index] / 32768;
    return samples;
  }

  // Any audio file the browser can play -> mono 16 kHz, first 15 s, loudness raised to full scale.
  async function decodeSirenFile(file) {
    const data = await file.arrayBuffer();
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context();
    let decoded;
    try {
      decoded = await context.decodeAudioData(data);
    } finally {
      context.close().catch(() => {});
    }
    const seconds = Math.min(SIREN_MAX_SECONDS, decoded.duration);
    const offline = new OfflineAudioContext(1, Math.max(1, Math.round(seconds * SIREN_RATE)), SIREN_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    let peak = 0;
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
    const gain = peak > 0.001 ? 0.97 / peak : 1;
    const pcm = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      pcm[index] = Math.max(-32768, Math.min(32767, Math.round(samples[index] * gain * 32767)));
    }
    let binary = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return { name: file.name, seconds: Math.round(seconds * 10) / 10, rate: SIREN_RATE, pcm: btoa(binary), cut: decoded.duration > SIREN_MAX_SECONDS };
  }

  // 1.11.17: the real siren - a generated wail (ptz-core sirenWave), 3 s, repeated.
  const SIREN_TONE_SECONDS = 3;
  let sirenToneSamples = null;
  let sirenToneMessage = null;
  function toneSamples() {
    if (!sirenToneSamples) sirenToneSamples = core.sirenWave(SIREN_RATE, SIREN_TONE_SECONDS);
    return sirenToneSamples;
  }

  function sirenChoice() {
    if (store.sirenSound === 'custom' && sirenSound) return 'custom';
    return store.sirenSound === 'testwav' ? 'testwav' : 'tone';
  }

  function renderSirenSound() {
    const choice = sirenChoice();
    $('ptz-siren-sound').value = choice;
    $('ptz-siren-file-name').textContent = sirenSound
      ? sirenSound.name + ' (' + sirenSound.seconds + ' s)'
      : 'No sound file chosen.';
    $('ptz-siren-preview').disabled = choice === 'testwav';
    $('ptz-siren-preview').title = choice === 'testwav'
      ? 'The AIRIZ test sound is stored on the AIRIZ, so it cannot be played here.'
      : 'Play the chosen siren sound on this PC';
    $('ptz-siren-clear').disabled = !sirenSound;
  }

  // Wail tone and sound file go to the AIRIZ like a voice message; the test sound is already there.
  function voiceSiren() {
    const choice = sirenChoice();
    if (choice === 'testwav' || !window.AirizVoice) return null;
    if (choice === 'custom') {
      if (!sirenMessage) sirenMessage = window.AirizVoice.buildMessage(sirenSamples(), sirenSound.rate);
      return { message: sirenMessage, seconds: sirenSound.seconds, label: 'your siren sound' };
    }
    if (!sirenToneMessage) sirenToneMessage = window.AirizVoice.buildMessage(toneSamples(), SIREN_RATE);
    return { message: sirenToneMessage, seconds: SIREN_TONE_SECONDS, label: 'the siren tone' };
  }

  // Plays the siren sound once on the AIRIZ: sends it first if the AIRIZ does not have it yet
  // (same sound -> same checksum as the last voice message -> just play it again).
  async function playVoiceSiren(sound) {
    const last = window.AirizVoice.state.lastTalk;
    if (last && last.md5 === sound.message.md5) {
      await api.sendCommand('diag audio play ' + TALK_FILE);
      return;
    }
    status('Sending ' + sound.label + ' to the AIRIZ (first time only)\u2026');
    await window.AirizVoice.send(sound.message);
  }

  async function startSiren(seconds) {
    if (!connected() || siren.active) return;
    const duration = Math.min(120, Math.max(3, Number(seconds) || 10));
    const sound = voiceSiren();
    siren.active = true;
    siren.until = Date.now() + duration * 1000;
    $('ptz-siren').disabled = true;
    $('ptz-siren-stop').disabled = false;
    await api.sendCommand('diag audio init');
    await sleep(400);
    await api.sendCommand('diag audio volume 100');
    await api.sendCommand('diag spotled on');
    const gap = sound ? Math.max(4000, Math.round(sound.seconds * 1000) + 500) : 4000;
    const play = async () => {
      if (!siren.active || Date.now() >= siren.until) {
        stopSiren();
        return;
      }
      if (sound) {
        try {
          await playVoiceSiren(sound);
        } catch {
          // the voice link failed (busy, Listen on, older firmware): the test sound still works
          await api.sendCommand('diag audio play ' + SIREN_WAV);
        }
      } else {
        await api.sendCommand('diag audio play ' + SIREN_WAV);
      }
      if (siren.active) siren.timer = setTimeout(play, gap);
    };
    play();
    status('Siren on for ' + duration + ' s' + (sound ? ' (' + sound.label + ').' : ' (AIRIZ test sound).'));
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

  $('ptz-siren-sound').addEventListener('change', () => {
    if ($('ptz-siren-sound').value === 'custom' && !sirenSound) {
      $('ptz-siren-file').click();
      return;
    }
    store.sirenSound = $('ptz-siren-sound').value;
    save();
    renderSirenSound();
  });
  $('ptz-siren-file-btn').addEventListener('click', () => $('ptz-siren-file').click());
  $('ptz-siren-file').addEventListener('change', async () => {
    const file = $('ptz-siren-file').files[0];
    $('ptz-siren-file').value = '';
    if (!file) {
      renderSirenSound();
      return;
    }
    $('ptz-siren-file-name').textContent = 'Reading the sound file\u2026';
    try {
      const sound = await decodeSirenFile(file);
      localStorage.setItem(SIREN_SOUND_KEY, JSON.stringify(sound));
      sirenSound = sound;
      sirenMessage = null;
      store.sirenSound = 'custom';
      save();
      renderSirenSound();
      status(sound.cut ? 'Siren sound saved: only its first 15 s are used.' : 'Siren sound saved.');
    } catch (error) {
      renderSirenSound();
      status('This file could not be read as sound. Try a WAV or MP3 file.', true);
    }
  });
  $('ptz-siren-preview').addEventListener('click', () => {
    const choice = sirenChoice();
    if (choice === 'testwav') return;
    const samples = choice === 'custom' ? sirenSamples() : toneSamples();
    const rate = choice === 'custom' ? sirenSound.rate : SIREN_RATE;
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => context.close().catch(() => {});
    source.start();
  });
  $('ptz-siren-clear').addEventListener('click', () => {
    localStorage.removeItem(SIREN_SOUND_KEY);
    sirenSound = null;
    sirenMessage = null;
    store.sirenSound = 'tone';
    save();
    renderSirenSound();
    status('Siren back to the wail tone.');
  });
  renderSirenSound();
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
        $('ptz-cal-status').textContent = 'Step 2 of 2: the camera moved. Click the SAME object again.';
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
      $('ptz-cal-status').textContent = 'Done: aim saved (' + perFrame + ' steps per picture ' + (calibration.axis === 'pan' ? 'width' : 'height') + '). The camera turns back.';
    } catch (error) {
      $('ptz-cal-status').textContent = error.message;
    }
    calibration.first = null;
    runMoves([{ axis: calibration.axis, delta: -calibration.steps }], newOperation());
  }

  $('ptz-cal-start').addEventListener('click', () => {
    if (!liveStream || !connected()) {
      $('ptz-cal-status').textContent = 'Connect the AIRIZ and start the camera preview first.';
      return;
    }
    setMode('move');
    calibration.axis = $('ptz-cal-axis').value === 'rising' ? 'rising' : 'pan';
    calibration.steps = Math.min(2000, Math.max(10, Number($('ptz-cal-steps').value) || 100));
    calibration.first = null;
    calibration.waiting = true;
    $('ptz-cal-status').textContent = 'Step 1 of 2: click a clear object in the picture (a corner, a lamp\u2026).';
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
    $('ptz-cal-status').textContent = 'The camera is moving: press "It stopped" the moment it stops.';
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
    $('ptz-cal-status').textContent = 'Done: timing saved (' + timingTest.steps + ' steps took ' + (measured / 1000).toFixed(1) + ' s).';
  });

  // 1.11.17: automatic calibration from the camera picture.
  function grayFrame(width) {
    const canvas = grabFrame(width);
    if (!canvas) return null;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { gray: core.toGray(pixels), width: canvas.width, height: canvas.height };
  }

  // Forward if there is room before the soft limit, otherwise backward; null if neither fits.
  function roomFor(axis, steps) {
    if (tracker.clampDelta(axis, steps) === steps) return steps;
    if (tracker.clampDelta(axis, -steps) === -steps) return -steps;
    return null;
  }

  const autoCal = { busy: false };

  // Aim: move a little, measure how far the picture moved (block matching), move back.
  $('ptz-cal-auto').addEventListener('click', async () => {
    if (!liveStream || !connected()) {
      $('ptz-cal-status').textContent = 'Connect the AIRIZ and start the camera preview first.';
      return;
    }
    if (autoCal.busy) return;
    const axis = $('ptz-cal-axis').value === 'rising' ? 'rising' : 'pan';
    const key = axis === 'pan' ? 'panStepsPerFrame' : 'risingStepsPerFrame';
    const perFrameNow = Math.abs(store.calibration[key]) || Math.abs(core.DEFAULT_CALIBRATION[key]);
    // about 15 % of the picture: enough to measure, small enough to keep most of the scene
    const steps = Math.min(2000, Math.max(10, Math.round(perFrameNow * 0.15)));
    const delta = roomFor(axis, steps);
    if (delta === null) {
      $('ptz-cal-status').textContent = 'Not enough room before the soft limits for a ' + steps + '-step test move.';
      return;
    }
    autoCal.busy = true;
    try {
      await sleep(300);
      const before = grayFrame(160);
      if (!before || core.frameContrast(before.gray) < 8) {
        $('ptz-cal-status').textContent = 'The picture has too little detail to measure (plain wall or dark). Point the camera at a busier scene, or use Start (click an object twice).';
        return;
      }
      $('ptz-cal-status').textContent = 'Measuring: moving ' + axis + ' ' + Math.abs(delta) + ' steps and back\u2026';
      const ok = await runMoves([{ axis, delta }], newOperation());
      if (!ok) {
        $('ptz-cal-status').textContent = 'Measurement cancelled.';
        return;
      }
      await sleep(600);
      const after = grayFrame(160);
      runMoves([{ axis, delta: -delta }], newOperation());
      if (!after || after.width !== before.width || after.height !== before.height) {
        $('ptz-cal-status').textContent = 'The camera picture changed size during the test. Try again.';
        return;
      }
      const shift = core.estimateShift(before.gray, after.gray, before.width, before.height, { maxShift: 0.4 });
      const along = axis === 'pan' ? shift.dx : shift.dy;
      const across = axis === 'pan' ? shift.dy : shift.dx;
      if (shift.confidence < 0.35 || Math.abs(along) < 0.02 || Math.abs(across) > Math.abs(along)) {
        $('ptz-cal-status').textContent = 'Could not measure a clear picture shift (match ' + Math.round(shift.confidence * 100)
          + ' %). Keep people and moving things out of view, or use Start (click an object twice).';
        return;
      }
      const perFrame = core.calibrateAxis(0, along, delta);
      store.calibration[key] = perFrame;
      save();
      renderCalibration();
      $('ptz-cal-status').textContent = 'Done: ' + Math.abs(delta) + ' steps moved the picture ' + Math.abs(along * 100).toFixed(1) + ' % of its '
        + (axis === 'pan' ? 'width' : 'height') + ' (match ' + Math.round(shift.confidence * 100) + ' %). Aim saved: '
        + perFrame + ' steps per picture ' + (axis === 'pan' ? 'width' : 'height') + '. The camera turns back.';
    } catch (error) {
      $('ptz-cal-status').textContent = error.message;
    } finally {
      autoCal.busy = false;
    }
  });

  // Timing: run the test move and watch the picture; the move ended when the picture stopped
  // changing. Each frame is compared with the one about 240 ms earlier (slow moves change a
  // small picture very little from one frame to the next).
  const TIMING_LAG_MS = 240;
  $('ptz-time-auto').addEventListener('click', async () => {
    if (!liveStream || !connected()) {
      $('ptz-cal-status').textContent = 'Connect the AIRIZ and start the camera preview first (or use Start test move and press It stopped).';
      return;
    }
    if (autoCal.busy) return;
    const axis = $('ptz-time-axis').value === 'rising' ? 'rising' : 'pan';
    const steps = Math.min(5000, Math.max(20, Number($('ptz-time-steps').value) || 200));
    const speed = store.speeds[axis];
    const delta = roomFor(axis, steps);
    if (delta === null) {
      $('ptz-cal-status').textContent = 'Not enough room before the soft limits for ' + steps + ' steps.';
      return;
    }
    autoCal.busy = true;
    const frames = [];
    const sample = (start) => {
      const frame = grayFrame(96);
      if (!frame) return null;
      const t = performance.now() - start;
      let reference = null;
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        if (t - frames[index].t >= TIMING_LAG_MS) {
          reference = frames[index];
          break;
        }
      }
      frames.push({ t, gray: frame.gray });
      if (frames.length > 40) frames.shift();
      return reference && reference.gray.length === frame.gray.length
        ? { t, diff: core.frameDifference(reference.gray, frame.gray) }
        : null;
    };
    try {
      const token = newOperation();
      if (!(await waitIdle(token))) return;
      $('ptz-cal-status').textContent = 'Measuring the picture noise\u2026';
      let noise = 0;
      const idleStart = performance.now();
      while (performance.now() - idleStart < 900) {
        const result = sample(idleStart);
        if (result) noise = Math.max(noise, result.diff);
        await sleep(80);
      }
      const threshold = Math.max(2, noise * 1.8 + 1);
      frames.length = 0;
      const expectedMs = core.estimateMoveMs(axis, steps, speed, store.timing);
      const maxMs = Math.min(45000, expectedMs * 3 + 4000);
      const sent = await api.sendCommand(core.motorCommand(axis, delta, speed));
      if (!sent) {
        $('ptz-cal-status').textContent = 'Motor command not sent. Check the connection and the console.';
        return;
      }
      const start = performance.now();
      $('ptz-cal-status').textContent = 'Watching the camera while ' + axis + ' moves ' + steps + ' steps\u2026';
      const samples = [];
      let stop = null;
      while (performance.now() - start < maxMs) {
        await sleep(80);
        if (token !== operation) {
          $('ptz-cal-status').textContent = 'Timing measurement cancelled.';
          return;
        }
        const result = sample(start);
        if (result) samples.push(result);
        stop = core.motionStopTime(samples, threshold, 800);
        if (stop) break;
        if (performance.now() - start > 3500 && !samples.some(item => item.diff > threshold)) break;
      }
      runMoves([{ axis, delta: -delta }], newOperation());
      if (!stop) {
        $('ptz-cal-status').textContent = samples.some(item => item.diff > threshold)
          ? 'The picture kept changing (people or lights moving?). Try again with a still scene, or press It stopped by hand.'
          : 'No movement seen in the camera picture. Check that the preview shows the AIRIZ camera, or use Start test move and It stopped.';
        return;
      }
      const measured = Math.max(50, stop.stoppedAt - TIMING_LAG_MS / 2);
      const k = core.timingFromMeasurement(steps, speed, measured);
      if (!k) return;
      store.timing[axis] = Math.round(k * 10) / 10;
      save();
      renderCalibration();
      $('ptz-cal-status').textContent = 'Done: timing saved from the camera (' + steps + ' steps took about ' + (measured / 1000).toFixed(1)
        + ' s at speed ' + speed + '). The camera goes back.';
    } finally {
      autoCal.busy = false;
    }
  });

  $('ptz-cal-reset').addEventListener('click', () => {
    store.calibration = { ...core.DEFAULT_CALIBRATION };
    store.timing = { ...core.DEFAULT_TIMING };
    save();
    renderCalibration();
    $('ptz-cal-status').textContent = 'Calibration reset to the defaults.';
  });

  function renderCalibration() {
    $('ptz-travel-rising').value = store.travel.risingMax;
    $('ptz-travel-pan').value = store.travel.panPerTurn;
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
  function applyTravel(change) {
    store.travel = core.normalizeTravel({ ...store.travel, ...change });
    tracker.setTravel(store.travel);
    renderPosition();
  }
  bindNumber('ptz-travel-rising', value => { if (value >= 100) applyTravel({ risingMax: value }); });
  bindNumber('ptz-travel-pan', value => { if (value >= 100) applyTravel({ panPerTurn: value }); });
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
    for (const button of document.querySelectorAll('[data-detect-toggle]')) {
      button.addEventListener('click', () => setArmed(!detection.armed));
    }
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
        if (key === 'notify' && settings.notify) {
          renderAlertStatus(!('Notification' in window) || Notification.permission === 'granted'
            ? '' : 'Desktop notification: ' + showDesktopAlert('', '', '').note);
        }
        if (key === 'teams' && settings.teams && !(window.AirizTeam && window.AirizTeam.member)) {
          renderDetectStatus('Teams alerts need Ziris PTB membership (Team page).');
        }
        if (key === 'track' && !settings.track) stopTracking();
        save();
        renderDetectStatus();
      });
    }
    for (const [id, key] of [['ptz-clip-seconds', 'clipSeconds'], ['ptz-spot-seconds', 'spotSeconds']]) {
      settings[key] = durationSetting(key, settings[key]);
      $(id).value = settings[key];
      $(id).addEventListener('change', () => {
        settings[key] = durationSetting(key, $(id).value);
        $(id).value = settings[key];
        save();
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
      zonesChanged();
      status('All zones deleted: Smart detection watches the whole picture.');
    });
    $('ptz-events-clear').addEventListener('click', () => {
      for (const event of detection.events) {
        if (event.photo) URL.revokeObjectURL(event.photo);
        if (event.clip) URL.revokeObjectURL(event.clip);
      }
      closeViewer();
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
  // 1.11.8: a worker keeps the detection ticks steady while the window is minimized (page
  // timers are slowed down to once a minute there); the Windows app also keeps working.
  (function startDetectClock() {
    try {
      const clock = new Worker('ptz-clock.js');
      clock.onmessage = () => analyse();
      clock.onerror = () => {
        clock.terminate();
        setInterval(analyse, DETECT_INTERVAL_MS);
      };
      clock.postMessage(DETECT_INTERVAL_MS);
    } catch {
      setInterval(analyse, DETECT_INTERVAL_MS);
    }
  })();
  // 1.11.1: the return after auto-tracking is checked on its own timer, so it also happens
  // while the window is hidden or minimized (the picture is not analysed then).
  setInterval(() => maybeReturnFromTracking(Date.now()), 1000);
  setInterval(() => renderDetectStatus(), 5000);

  // Actions a device that controls through this console asks for (1.11.1, remote-control.js).
  function runShared(action, args, from) {
    const who = String(from || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'Remote device';
    const options = args && typeof args === 'object' ? args : {};
    switch (action) {
      case 'go-home':
        stopScan();
        goHome(who);
        return true;
      case 'set-home':
        setHomeHere(who);
        return true;
      case 'set-limit':
        if (!core.AXES.includes(options.axis) || !['min', 'max'].includes(options.side)) return false;
        setLimitHere(options.axis, options.side, who);
        return true;
      case 'clear-limits':
        clearLimits(who);
        return true;
      case 'find-rising-home':
        findRisingHomeAction(who);
        return true;
      case 'read-switch':
        if (!connected()) {
          status('Connect the AIRIZ first (USB, or Try demo).', true, who);
          return true;
        }
        readSwitch().then(() => status($('ptz-switch-state').textContent, false, who));
        return true;
      default:
        return false;
    }
  }

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
    get risingReferenced() {
      return tracker.risingRef;
    },
    get travel() {
      return tracker.travel;
    },
    get home() {
      return tracker.home;
    },
    get statusText() {
      return lastStatus.text;
    },
    // 1.11.1 shared camera: the console with the cable publishes, controllers adopt.
    get synced() {
      return remote.synced;
    },
    shared: () => sharedState(),
    onShared(listener) {
      if (typeof listener !== 'function') return () => {};
      sharedListeners.add(listener);
      return () => sharedListeners.delete(listener);
    },
    runShared,
    applyHost: (state, receivedAt) => applyHostState(state, receivedAt),
    goHome: () => goHome(),
    pose(at) {
      const live = tracker.livePosition(at || Date.now());
      return { ...live, ...core.describePose(live, { travel: tracker.travel, risingRef: tracker.risingRef }) };
    },
    centerOn: (u, v) => centerOn({ u, v }),
    moveTo: (pan, rising, label) => moveTo({ pan, rising }, label),
    readSwitch,
    nightTick
  });
})();
