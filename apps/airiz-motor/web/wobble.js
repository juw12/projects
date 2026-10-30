/* AIRIZ wobble test (1.11.19), Camera tab.
 *
 * Rising up/down wobble, graded like the bench standard (limit = grade 1):
 *   1 No wobbling (not visible at 15 cm) · 2 Very slight (15 cm, not 30 cm)
 *   3 Slight (30 cm) · 4 Wobbling (obvious at 30 cm)
 * Sequence: lower to the bottom (not measured) -> 1 s still (camera noise) -> full rise
 * (measured "up") -> full down (measured "down"). Frames are recorded during each move and
 * analysed afterwards (wobble-core.js). The worse direction decides the grade.
 * The grade borders come from one number, the grade-1 limit T (degrees, peak to peak): T, 2T, 4T.
 * T starts as an estimate; "What did you see by eye?" collects graded units and
 * "Fit the grade borders" sets T from them.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const core = window.AirizWobbleCore;
  const ptz = window.AirizPtzCore;
  const $ = id => document.getElementById(id);
  if (!api || !core || !ptz || !$('wobble-test')) return;

  const STORE_KEY = 'airiz.wobble.v1';
  const FULL_TRAVEL = 1100;
  const FRAME_WIDTH = 240;
  const MAX_SHIFT_PX = 16;
  const STILL_MS = 1000;
  const SETTLE_MS = 1000;
  const HISTORY_MAX = 50;
  const MIN_FPS = 12;           // below this a few-Hz wobble cannot be measured reliably
  const MIN_STEADY_SAMPLES = 15; // frames in the measured (steady) part of each move

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const round = (value, digits) => Number(value).toFixed(digits);

  function loadStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return {
        grade1Limit: saved.grade1Limit > 0 ? saved.grade1Limit : core.DEFAULT_GRADE1_LIMIT_DEG,
        taught: !!saved.taught,
        fov: saved.fov > 5 && saved.fov < 180 ? saved.fov : core.DEFAULT_FOV_DEG,
        limitGrade: [1, 2, 3, 4].includes(saved.limitGrade) ? saved.limitGrade : 1,
        graded: Array.isArray(saved.graded) ? saved.graded.slice(-200) : [],
        history: Array.isArray(saved.history) ? saved.history.slice(-HISTORY_MAX) : [],
      };
    } catch (ignored) {
      return { grade1Limit: core.DEFAULT_GRADE1_LIMIT_DEG, taught: false, fov: core.DEFAULT_FOV_DEG, limitGrade: 1, graded: [], history: [] };
    }
  }
  const store = loadStore();
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (ignored) { /* storage blocked: this session only */ }
  }

  function setStatus(text, state) {
    const status = $('wobble-status');
    status.textContent = text;
    status.dataset.state = state || '';
  }

  // ------------------------------------------------------------------ camera frames
  const camera = { video: null, stream: null, canvas: null, context: null };

  function cameraVideo() {
    const stream = api.getCameraStream();
    if (!stream) return null;
    if (!camera.video) {
      camera.video = document.createElement('video');
      camera.video.muted = true;
      camera.video.playsInline = true;
      camera.video.setAttribute('aria-hidden', 'true');
      camera.video.className = 'motion-probe-video';
      document.body.append(camera.video);
    }
    if (camera.stream !== stream) {
      camera.stream = stream;
      camera.video.srcObject = stream;
      camera.video.play().catch(() => {});
    }
    return camera.video;
  }

  async function readyVideo() {
    const stream = api.getCameraStream();
    if (stream && stream.getVideoTracks()[0] && typeof window.MediaStreamTrackProcessor === 'function') {
      return { track: true };
    }
    const video = cameraVideo();
    if (!video) return null;
    for (let waited = 0; !video.videoWidth && waited < 3000; waited += 100) {
      if (video.paused) video.play().catch(() => {});
      await sleep(100);
    }
    if (video.videoWidth) return video;
    // the helper video did not start: use the camera preview itself
    const preview = document.getElementById('camera-preview');
    return preview && preview.srcObject === api.getCameraStream() && preview.videoWidth ? preview : null;
  }

  function grab(source, sourceWidth, sourceHeight) {
    const width = FRAME_WIDTH;
    const height = Math.max(60, Math.round(width * sourceHeight / sourceWidth));
    if (!camera.canvas) {
      camera.canvas = document.createElement('canvas');
      camera.context = camera.canvas.getContext('2d', { willReadFrequently: true });
    }
    if (camera.canvas.width !== width || camera.canvas.height !== height) {
      camera.canvas.width = width;
      camera.canvas.height = height;
    }
    camera.context.drawImage(source, 0, 0, width, height);
    return { gray: ptz.toGray(camera.context.getImageData(0, 0, width, height).data), width, height };
  }

  // Record frames until stop() says so (or maxMs passes).
  // Best: read every frame straight from the camera track (MediaStreamTrackProcessor: Chrome,
  // Edge, the Windows app) with the camera's own frame time - no page element involved, so a
  // scrolled-away or paused preview does not matter. Otherwise: from a video element.
  function record(video, options) {
    const stream = api.getCameraStream();
    const track = stream && stream.getVideoTracks()[0];
    if (track && typeof window.MediaStreamTrackProcessor === 'function') return recordTrack(track, options);
    return recordElement(video, options);
  }

  async function recordTrack(sourceTrack, options) {
    const frames = [];
    const track = sourceTrack.clone(); // our own copy: stopping it does not stop the preview
    const reader = new window.MediaStreamTrackProcessor({ track }).readable.getReader();
    const started = performance.now();
    let firstTimestamp = null;
    try {
      for (;;) {
        const now = performance.now();
        if (run.cancelled || now - started > options.maxMs) break;
        const next = await Promise.race([
          reader.read(),
          sleep(Math.max(50, options.maxMs - (now - started) + 50)).then(() => ({ timeout: true })),
        ]);
        if (next.timeout || next.done) break;
        const videoFrame = next.value;
        try {
          if (firstTimestamp === null) firstTimestamp = videoFrame.timestamp;
          const frame = grab(videoFrame, videoFrame.displayWidth, videoFrame.displayHeight);
          let t = (videoFrame.timestamp - firstTimestamp) / 1000; // microseconds -> ms
          const previous = frames[frames.length - 1];
          if (previous && t <= previous.t) t = previous.t + 1;
          frames.push({ t, gray: frame.gray, width: frame.width, height: frame.height });
        } finally {
          videoFrame.close();
        }
        if (options.stop && options.stop(frames, performance.now() - started)) break;
      }
    } finally {
      reader.cancel().catch(() => {});
      track.stop();
    }
    return frames;
  }

  function recordElement(video, options) {
    const frames = [];
    const started = performance.now();
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(frames);
      };
      let firstMediaTime = null;
      const step = metadata => {
        if (done) return;
        const now = performance.now();
        if (run.cancelled || now - started > options.maxMs) {
          finish();
          return;
        }
        const frame = grab(video, video.videoWidth, video.videoHeight);
        // Prefer the camera's own frame time: the page may pick frames up late or unevenly, and
        // a late timestamp makes steady travel look jerky.
        let t = now - started;
        if (metadata && Number.isFinite(metadata.mediaTime)) {
          if (firstMediaTime === null) firstMediaTime = metadata.mediaTime - t / 1000;
          const cameraTime = (metadata.mediaTime - firstMediaTime) * 1000;
          // trust the camera time unless it drifts away from the page clock (a paused stream)
          if (Math.abs(cameraTime - t) < 250) t = cameraTime;
        }
        const previous = frames[frames.length - 1];
        if (previous && t <= previous.t) t = previous.t + 1;
        frames.push({ t, gray: frame.gray, width: frame.width, height: frame.height });
        if (options.stop && options.stop(frames, now - started)) {
          finish();
          return;
        }
        schedule();
      };
      // Next frame: the camera's frame callback when the browser has it, but never wait more
      // than 100 ms for it (a busy or throttled page): then take the current picture anyway.
      const schedule = () => {
        let fired = false;
        const once = metadata => {
          if (fired) return;
          fired = true;
          step(metadata);
        };
        if (typeof video.requestVideoFrameCallback === 'function' && !document.hidden) {
          video.requestVideoFrameCallback((ignored, metadata) => once(metadata));
          setTimeout(() => once(null), 100);
        } else {
          setTimeout(() => once(null), 33);
        }
      };
      step();
    });
  }

  // Frame-to-frame picture path of a recording: [{t, x, y}] plus the share of unsure matches.
  async function pathOf(frames, onProgress) {
    const path = [{ t: frames.length ? frames[0].t : 0, x: 0, y: 0 }];
    let x = 0;
    let y = 0;
    let unsure = 0;
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1];
      const b = frames[i];
      if (a.width !== b.width || a.height !== b.height) continue;
      const shift = core.measureShift(a.gray, b.gray, b.width, b.height, MAX_SHIFT_PX);
      if (shift.confidence < 0.15) unsure += 1;
      x += shift.x;
      y += shift.y;
      path.push({ t: b.t, x, y, dx: shift.x, dy: shift.y, confidence: shift.confidence });
      if (i % 8 === 0) {
        if (onProgress) onProgress(i / frames.length);
        await sleep(0); // keep the page responsive
      }
    }
    return { path, unsureShare: frames.length > 1 ? unsure / (frames.length - 1) : 1, width: frames.length ? frames[0].width : FRAME_WIDTH };
  }

  // ------------------------------------------------------------------ the test run
  const run = { active: false, cancelled: false };
  const lastAnalysis = {};

  function risingSpeed() {
    const input = $('ptz-rising-speed') || $('rising-speed');
    return Math.max(1, Math.min(30, Number(input && input.value) || 3));
  }

  function risingTiming() {
    const input = $('ptz-time-rising');
    const value = Number(input && input.value);
    return value > 0 ? { rising: value } : undefined;
  }

  function expectedMoveMs(speed) {
    return ptz.estimateMoveMs('rising', FULL_TRAVEL, speed, risingTiming());
  }

  async function sendMove(direction, speed) {
    const delta = direction === 'up' ? FULL_TRAVEL : -FULL_TRAVEL;
    return api.sendCommand(ptz.motorCommand('rising', delta, speed));
  }

  // One measured move: start recording, send the move, stop once the picture has been still
  // for SETTLE_MS after it moved (or after the longest plausible time).
  async function measureMove(video, direction, speed, noise) {
    const expected = expectedMoveMs(speed);
    const maxMs = Math.max(4000, Math.min(60000, expected * 2 + 4000));
    let previous = null;
    let moved = false;
    let lastMotion = 0;
    const threshold = Math.max(2, noise.frameDifference * 3 + 1);
    const recording = record(video, {
      maxMs,
      stop(frames, elapsed) {
        const frame = frames[frames.length - 1];
        if (previous && previous.length === frame.gray.length) {
          const difference = ptz.frameDifference(previous, frame.gray);
          if (difference > threshold) {
            moved = true;
            lastMotion = elapsed;
          }
        }
        previous = frame.gray;
        return moved && elapsed - lastMotion > SETTLE_MS && elapsed > Math.min(expected, 1500);
      },
    });
    await sleep(60);
    const sent = await sendMove(direction, speed);
    if (!sent) {
      run.cancelled = true;
      await recording;
      run.cancelled = false;
      throw new Error('The ' + direction + ' move was not sent.');
    }
    const frames = await recording;
    return { frames, moved, expected };
  }

  async function analyse(direction, measured, noise) {
    setStatus('Analysing the ' + direction + ' move (' + measured.frames.length + ' frames)\u2026', 'busy');
    const tracked = await pathOf(measured.frames, share => {
      setStatus('Analysing the ' + direction + ' move\u2026 ' + Math.round(share * 100) + ' %', 'busy');
    });
    // only the steady travel counts: the start and the stop of the move are left out
    const steady = core.steadyPart(tracked.path);
    const shake = core.wobbleFromPath(tracked.path, { fromMs: steady.fromMs, toMs: steady.toMs });
    lastAnalysis[direction] = { path: tracked.path, fromMs: steady.fromMs, toMs: steady.toMs, width: tracked.width };
    // graded: sideways (across the travel); along the travel is shown for information
    const cleanPx = core.withoutNoise(shake.acrossPx, noise.acrossPx);
    const wobbleDeg = core.pixelsToDegrees(cleanPx, tracked.width, store.fov);
    const fps = measured.frames.length > 1
      ? (measured.frames.length - 1) / ((measured.frames[measured.frames.length - 1].t - measured.frames[0].t) / 1000)
      : 0;
    return {
      direction,
      wobbleDeg,
      alongDeg: core.pixelsToDegrees(core.withoutNoise(shake.alongPx, noise.alongPx), tracked.width, store.fov),
      noiseDeg: core.pixelsToDegrees(noise.acrossPx, tracked.width, store.fov),
      frames: measured.frames.length,
      fps,
      moved: measured.moved,
      steadyMs: steady.trimmed ? Math.max(0, steady.toMs - steady.fromMs) : 0,
      unsureShare: tracked.unsureShare,
      steadySamples: shake.residual.length,
      residual: shake.residual.map(point => ({
        t: point.t,
        deg: core.pixelsToDegrees(Math.abs(point.across), tracked.width, store.fov),
      })),
    };
  }

  async function measureNoise(video) {
    const frames = await record(video, { maxMs: STILL_MS });
    const tracked = await pathOf(frames);
    // the head stands still: across / along the (vertical) travel direction of the test
    const shake = core.wobbleFromPath(tracked.path, { direction: { x: 0, y: 1 } });
    let difference = 0;
    for (let i = 1; i < frames.length; i += 1) difference += ptz.frameDifference(frames[i - 1].gray, frames[i].gray);
    return {
      peakToPeakPx: shake.peakToPeakPx,
      acrossPx: shake.acrossPx,
      alongPx: shake.alongPx,
      frames: frames.length,
      frameDifference: frames.length > 1 ? difference / (frames.length - 1) : 1,
      unsureShare: tracked.unsureShare,
    };
  }

  async function startTest() {
    if (run.active) return;
    const status = api.getStatus();
    if (!status.connected) {
      setStatus('Connect the AIRIZ first (USB).', 'warn');
      return;
    }
    if (String(status.transportLabel || '').startsWith('Remote')) {
      setStatus('Run the wobble test on the PC that has the AIRIZ on USB (it needs the camera picture there).', 'warn');
      return;
    }
    const video = await readyVideo();
    if (!video) {
      setStatus('Start the camera preview first (Camera \u2192 Start Preview). The test measures the shake in the camera picture.', 'warn');
      return;
    }
    run.active = true;
    run.cancelled = false;
    renderButtons();
    $('wobble-result').hidden = true;
    const speed = risingSpeed();
    try {
      setStatus('Lowering to the bottom first (not measured)\u2026', 'busy');
      if (!(await sendMove('down', speed))) throw new Error('The move to the bottom was not sent.');
      await sleep(expectedMoveMs(speed) + 1200);
      if (run.cancelled) throw new Error('Stopped.');

      setStatus('Measuring the camera noise (head still, 1 s)\u2026', 'busy');
      const noise = await measureNoise(video);
      if (noise.frames < 6) {
        throw new Error('The camera picture hardly updates (' + noise.frames + ' frames in 1 s). Close other camera '
          + 'windows and busy programs, keep the console window in front, and try again.');
      }
      if (noise.unsureShare > 0.5) {
        throw new Error('The picture has too little detail to track. Point the camera at a detailed, well-lit scene '
          + '(a printed pattern or a shelf, not a plain wall) and keep people out of it.');
      }

      const results = [];
      for (const direction of ['up', 'down']) {
        if (run.cancelled) throw new Error('Stopped.');
        setStatus(direction === 'up' ? 'Rising to the top \u2013 measuring\u2026' : 'Lowering to the bottom \u2013 measuring\u2026', 'busy');
        const measured = await measureMove(video, direction, speed, noise);
        if (run.cancelled) throw new Error('Stopped.');
        results.push(await analyse(direction, measured, noise));
      }
      finishTest(results, status.demoMode);
    } catch (error) {
      setStatus((error && error.message) || 'The wobble test failed.', 'warn');
    } finally {
      run.active = false;
      run.cancelled = false;
      renderButtons();
    }
  }

  async function stopTest() {
    if (!run.active) return;
    run.cancelled = true;
    await api.stopMotor();
    setStatus('Stopping\u2026 (motor stop sent)', 'warn');
  }

  // ------------------------------------------------------------------ result, history, teaching
  let lastResult = null;

  function finishTest(results, demo) {
    const notes = [];
    for (const item of results) {
      if (!item.moved) notes.push('No movement was seen in the camera picture during the ' + item.direction + ' move.');
      if (item.unsureShare > 0.3) notes.push('Part of the ' + item.direction + ' move could not be tracked well (blur or plain picture).');
      if (item.moved && item.steadyMs && item.steadyMs < 1000) notes.push('The ' + item.direction + ' move was short (' + (item.steadyMs / 1000).toFixed(1)
        + ' s of steady travel measured): use a slower rising speed for a more reliable grade.');
      if (item.fps >= MIN_FPS && item.fps < 20) notes.push('Only ' + Math.round(item.fps) + ' frames per second: fast shaking may be under-measured.');
    }
    const noiseDeg = Math.max(...results.map(item => item.noiseDeg));
    if (noiseDeg > store.grade1Limit / 2) {
      notes.push('The camera noise (' + round(noiseDeg, 3) + '\u00b0) is large compared with the grade-1 limit: '
        + 'use more light and a detailed scene for a reliable grade.');
    }
    if (demo) notes.push('Demo mode: no real AIRIZ moved, the grade only reflects the camera picture.');
    const unreliable = [];
    for (const item of results) {
      if (!item.moved) unreliable.push('no movement seen (' + item.direction + ')');
      else if (item.fps < MIN_FPS) unreliable.push(Math.round(item.fps) + ' frames per second (' + item.direction + '; at least ' + MIN_FPS + ' needed)');
      else if (item.steadySamples < MIN_STEADY_SAMPLES) unreliable.push('too few frames in the steady travel (' + item.direction + ')');
      else if (item.unsureShare > 0.3) unreliable.push('picture hard to track (' + item.direction + ')');
    }
    const reliable = unreliable.length === 0;
    if (!reliable) {
      notes.unshift('Not a reliable result: ' + unreliable.join(', ') + '. The unit is not passed. Close other camera '
        + 'windows and busy programs, keep the console window in front with the camera preview visible, and test again.');
    }
    const summary = core.summarize(results, store.grade1Limit, store.limitGrade);
    if (!reliable) summary.pass = false;
    lastResult = {
      at: new Date().toISOString(),
      grade: summary.grade,
      name: summary.name,
      pass: summary.pass,
      limitGrade: summary.limitGrade,
      wobbleDeg: summary.wobbleDeg,
      worstDirection: summary.worstDirection,
      upDeg: results[0] ? results[0].wobbleDeg : null,
      downDeg: results[1] ? results[1].wobbleDeg : null,
      grade1Limit: store.grade1Limit,
      demo: !!demo,
      reliable,
      eyeGrade: null,
    };
    store.history.push(lastResult);
    store.history = store.history.slice(-HISTORY_MAX);
    saveStore();
    renderResult(summary, results, notes, reliable);
    renderHistory();
    setStatus(reliable
      ? 'Wobble test finished: grade ' + summary.grade + ' \u2013 ' + summary.name + ' \u2013 ' + (summary.pass ? 'PASS' : 'FAIL') + '.'
      : 'Wobble test not reliable \u2013 test again (see the notes).', summary.pass ? 'ok' : 'warn');
  }

  function renderResult(summary, results, notes, reliable) {
    const box = $('wobble-result');
    box.hidden = false;
    box.dataset.grade = String(summary.grade);
    box.dataset.pass = summary.pass ? '1' : '0';
    box.dataset.reliable = reliable ? '1' : '0';
    $('wobble-grade').textContent = String(summary.grade);
    $('wobble-grade-name').textContent = summary.name;
    $('wobble-grade-detail').textContent = summary.detail;
    $('wobble-verdict').textContent = reliable
      ? (summary.pass ? 'PASS' : 'FAIL') + ' \u00b7 limit: grade ' + summary.limitGrade
      : 'NOT RELIABLE \u00b7 test again';
    const rows = results.map(item => {
      const grade = core.gradeFor(item.wobbleDeg, store.grade1Limit);
      return (item.direction === 'up' ? 'Rising up' : 'Going down') + ': ' + round(item.wobbleDeg, 3) + '\u00b0 (grade '
        + grade.grade + ' \u00b7 along the travel ' + round(item.alongDeg, 3) + '\u00b0, not graded \u00b7 ' + item.frames + ' frames)';
    });
    rows.push('Worst: ' + round(summary.wobbleDeg, 3) + '\u00b0 = ' + Math.round(summary.ofGrade1Limit * 100)
      + ' % of the grade-1 limit (' + round(store.grade1Limit, 3) + '\u00b0' + (store.taught ? ', taught' : ', estimate') + ').');
    $('wobble-numbers').replaceChildren(...rows.map(text => Object.assign(document.createElement('li'), { textContent: text })));
    const noteList = $('wobble-notes');
    noteList.replaceChildren(...notes.map(text => Object.assign(document.createElement('li'), { textContent: text })));
    noteList.hidden = !notes.length;
    $('wobble-eye').value = '';
    drawChart(results.find(item => item.direction === summary.worstDirection) || results[0]);
  }

  function drawChart(item) {
    const canvas = $('wobble-chart');
    const context = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    if (!item || !item.residual.length) return;
    const borders = core.gradeBorders(store.grade1Limit);
    const peak = Math.max(borders[1] * 1.15, ...item.residual.map(point => point.deg)) || 1;
    const t0 = item.residual[0].t;
    const span = Math.max(1, item.residual[item.residual.length - 1].t - t0);
    const yOf = deg => height - 4 - (deg / peak) * (height - 8);
    context.lineWidth = 1;
    context.font = '10px sans-serif';
    borders.forEach((border, index) => {
      if (border > peak) return;
      context.strokeStyle = ['#3fb950', '#d29922', '#f85149'][index];
      context.setLineDash([4, 3]);
      context.beginPath();
      context.moveTo(0, yOf(border));
      context.lineTo(width, yOf(border));
      context.stroke();
      context.fillStyle = context.strokeStyle;
      context.fillText('grade ' + (index + 1) + ' limit', 4, yOf(border) - 2);
    });
    context.setLineDash([]);
    context.strokeStyle = '#58a6ff';
    context.beginPath();
    item.residual.forEach((point, index) => {
      const x = ((point.t - t0) / span) * width;
      // the residual is the distance from the smooth path: peak-to-peak is about twice that
      const y = yOf(point.deg * 2);
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    });
    context.stroke();
  }

  function saveEyeGrade() {
    const grade = Number($('wobble-eye').value);
    if (!lastResult || !(grade >= 1 && grade <= 4)) {
      setStatus('Run a test, then choose the grade you saw by eye.', 'warn');
      return;
    }
    lastResult.eyeGrade = grade;
    store.graded.push({ wobbleDeg: lastResult.wobbleDeg, grade, at: lastResult.at });
    saveStore();
    renderHistory();
    renderTeach();
    setStatus('Saved: you saw grade ' + grade + ' by eye, the console measured ' + round(lastResult.wobbleDeg, 3) + '\u00b0.', 'ok');
  }

  function fitBorders() {
    const fit = core.suggestGrade1Limit(store.graded);
    if (!fit) {
      setStatus('Grade a few units by eye first (after each test: "What did you see by eye?").', 'warn');
      return;
    }
    store.grade1Limit = fit.grade1Limit;
    store.taught = true;
    saveStore();
    renderSettings();
    renderTeach();
    setStatus('Grade borders fitted to ' + fit.units + ' graded units: grade-1 limit ' + round(fit.grade1Limit, 3)
      + '\u00b0 (' + fit.wrong + ' of ' + fit.units + ' would be graded differently).', 'ok');
  }

  function renderTeach() {
    const count = store.graded.length;
    $('wobble-teach-count').textContent = count
      ? count + ' unit' + (count === 1 ? '' : 's') + ' graded by eye so far.'
      : 'No units graded by eye yet.';
    $('wobble-fit').disabled = !count;
    $('wobble-forget').disabled = !count;
  }

  function renderSettings() {
    $('wobble-limit-grade').value = String(store.limitGrade);
    $('wobble-grade1').value = round(store.grade1Limit, 3);
    $('wobble-fov').value = String(store.fov);
    const borders = core.gradeBorders(store.grade1Limit);
    $('wobble-borders').textContent = 'Grade 1 up to ' + round(borders[0], 3) + '\u00b0 \u00b7 grade 2 up to '
      + round(borders[1], 3) + '\u00b0 \u00b7 grade 3 up to ' + round(borders[2], 3) + '\u00b0 \u00b7 grade 4 above. '
      + (store.taught ? '(Fitted to graded units.)' : '(Estimate: fit it to units graded by eye.)');
  }

  function renderHistory() {
    const list = $('wobble-history');
    if (!store.history.length) {
      list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No tests yet.' }));
      $('wobble-export').disabled = true;
      return;
    }
    $('wobble-export').disabled = false;
    list.replaceChildren(...store.history.slice(-8).reverse().map(item => {
      const row = document.createElement('li');
      row.dataset.pass = item.pass ? '1' : '0';
      const when = new Date(item.at).toLocaleString();
      row.textContent = when + ' \u00b7 grade ' + item.grade + ' (' + item.name + ') \u00b7 ' + round(item.wobbleDeg, 3) + '\u00b0 \u00b7 '
        + (item.reliable === false ? 'NOT RELIABLE' : item.pass ? 'PASS' : 'FAIL') + (item.eyeGrade ? ' \u00b7 by eye: ' + item.eyeGrade : '') + (item.demo ? ' \u00b7 demo' : '');
      return row;
    }));
  }

  function exportCsv() {
    const header = ['time', 'grade', 'name', 'pass', 'limit_grade', 'wobble_deg', 'up_deg', 'down_deg', 'worst', 'grade1_limit_deg', 'eye_grade', 'demo'];
    const lines = [header.join(',')].concat(store.history.map(item => [
      item.at, item.grade, '"' + item.name + '"', item.reliable === false ? 'NOT RELIABLE' : item.pass ? 'PASS' : 'FAIL', item.limitGrade,
      round(item.wobbleDeg, 4), item.upDeg == null ? '' : round(item.upDeg, 4), item.downDeg == null ? '' : round(item.downDeg, 4),
      item.worstDirection, round(item.grade1Limit, 4), item.eyeGrade || '', item.demo ? 1 : 0,
    ].join(',')));
    const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'airiz-wobble-tests-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  function renderButtons() {
    $('wobble-start').disabled = run.active;
    $('wobble-stop').disabled = !run.active;
  }

  // ------------------------------------------------------------------ wiring
  $('wobble-start').addEventListener('click', startTest);
  $('wobble-stop').addEventListener('click', stopTest);
  $('wobble-eye-save').addEventListener('click', saveEyeGrade);
  $('wobble-fit').addEventListener('click', fitBorders);
  $('wobble-forget').addEventListener('click', () => {
    store.graded = [];
    saveStore();
    renderTeach();
    setStatus('Graded units forgotten.', 'ok');
  });
  $('wobble-export').addEventListener('click', exportCsv);
  $('wobble-limit-grade').addEventListener('change', event => {
    store.limitGrade = Number(event.target.value) || 1;
    saveStore();
  });
  $('wobble-grade1').addEventListener('change', event => {
    const value = Number(event.target.value);
    if (value > 0 && value < 10) {
      store.grade1Limit = value;
      store.taught = false;
      saveStore();
    }
    renderSettings();
  });
  $('wobble-fov').addEventListener('change', event => {
    const value = Number(event.target.value);
    if (value > 5 && value < 180) {
      store.fov = value;
      saveStore();
    }
    renderSettings();
  });

  renderSettings();
  renderTeach();
  renderHistory();
  renderButtons();

  window.AirizWobble = Object.freeze({
    start: startTest,
    stop: stopTest,
    get running() {
      return run.active;
    },
    get lastResult() {
      return lastResult ? { ...lastResult } : null;
    },
    // frame-by-frame picture path of the last test (for support / diagnosis)
    get lastAnalysis() {
      return JSON.parse(JSON.stringify(lastAnalysis));
    },
    get settings() {
      return { grade1Limit: store.grade1Limit, fov: store.fov, limitGrade: store.limitGrade, taught: store.taught };
    },
  });
})();
