/* AIRIZ Control Center — dependency-free, progressively enhanced controller. */
(() => {
  'use strict';

  function initDashboard() {
    const $ = (id) => document.getElementById(id);
    const api = window.AirizConsole;
    if (!api) return;

    const views = {
      controller: ['Motor control', 'Make your next move. Precision control for your device.'],
      console: ['Commands & macros', 'Your complete command library and repeatable test workflows.'],
      camera: window.airizMobile ? ['Phone camera', 'Local phone-camera preview, not video over Bluetooth.'] : ['Camera workspace', 'Preview, capture, and inspect your device camera.'],
      team: ['Ziris PTB team', 'Owner Juwen Lie with co-admins. Members post share codes to the Ziris PTB Teams chat automatically.'],
      guide: ['Guide & history', 'How to use every part of the AIRIZ console, and how it was built.']
    };
    const commandDefinitions = new Map(
      window.AIRIZ_COMMANDS.groups.flatMap((group) => group.commands).map((command) => [command.id, command])
    );
    const jogButtons = [...document.querySelectorAll('[data-jog]')];
    const presetButtons = [...document.querySelectorAll('[data-steps]')];
    // 1.11.16: step presets 100 / 600 / 1100 (was 1 / 10 / 100); the console starts on the first one.
    const JOG_PRESET_STEPS = presetButtons.map((button) => Number(button.dataset.steps));
    const jogInputIds = ['pan-speed', 'pan-steps', 'rising-speed', 'rising-steps'];
    // 1.11.16: left / right controls turn the camera the same way as the arrow. Before, left sent
    // "pan reverse" and the camera picture moved right. "Opposite direction" brings the old mapping
    // back. One setting for the Motor control jog pad, the arrow keys and the PTZ hold arrows.
    const PAN_SWAP_KEY = 'airiz.panArrowsOpposite';
    function panArrowsOpposite() {
      try {
        return localStorage.getItem(PAN_SWAP_KEY) === '1';
      } catch (error) {
        return false;
      }
    }
    function panCommandFor(side) {
      const leftCommand = panArrowsOpposite() ? 'pan-rev' : 'pan-fwd';
      if (side === 'left') return leftCommand;
      return leftCommand === 'pan-fwd' ? 'pan-rev' : 'pan-fwd';
    }
    function applyPanArrows() {
      for (const side of ['left', 'right']) {
        const command = panCommandFor(side);
        const word = command === 'pan-fwd' ? 'forward' : 'reverse';
        const jogButton = document.querySelector('.jog-' + side);
        if (jogButton) {
          jogButton.dataset.jog = command;
          const caption = jogButton.querySelector('span');
          if (caption) caption.textContent = command === 'pan-fwd' ? 'FWD' : 'REV';
          jogButton.setAttribute('aria-label', 'Jog ' + side + ' (pan ' + word + ')');
          jogButton.title = 'Pan ' + word + ' / Arrow ' + side;
        }
        const holdButton = document.querySelector('.ptz-hold-' + side);
        if (holdButton) {
          holdButton.dataset.hold = 'pan:' + (command === 'pan-fwd' ? 1 : -1);
          holdButton.setAttribute('aria-label', 'Hold to turn ' + side + ' (pan ' + word + ')');
        }
      }
      const opposite = panArrowsOpposite();
      document.querySelectorAll('[data-pan-swap]').forEach((button) => {
        button.setAttribute('aria-pressed', String(opposite));
        const label = button.querySelector('span') || button;
        label.textContent = opposite ? 'Left/right: opposite direction' : 'Left/right: same direction';
        button.title = 'Click to switch. Same direction: pressing left turns the camera left. '
          + 'Opposite direction: the old mapping (left = pan reverse).';
      });
    }
    function setPanArrowsOpposite(opposite) {
      try {
        localStorage.setItem(PAN_SWAP_KEY, opposite ? '1' : '0');
      } catch (error) { /* storage blocked: this session only */ }
      applyPanArrows();
    }
    // 1.11.9: Full rise / Full down move the rising axis over its whole travel in one finite move.
    const FULL_TRAVEL_STEPS = 1100;
    const fullTravelButtons = [...document.querySelectorAll('[data-full-travel]')];
    const originalTerminal = document.querySelector('.panel-console');
    const consoleOutput = $('console-output');
    let currentView = 'controller';
    let previewDirection = 'pan-fwd';
    let previewSteps = null;
    let armed = false;
    let keyboardEnabled = false;
    let busy = false;
    let lastConnection = '';
    let bluetoothSending = false;
    let hardwareCheckRunning = false;
    let connectedAt = 0;
    let toastTimeout;
    let animationTimeout;
    let transmitted = 0;
    let received = 0;
    const history = [];
    let historyIndex = 0;
    let historyDraft = '';

    for (const [axis, commandId] of [['pan', 'pan-fwd'], ['rising', 'rising-fwd']]) {
      const command = commandDefinitions.get(commandId);
      const speedParameter = command.params.find((parameter) => parameter.key === 'x');
      const stepsParameter = command.params.find((parameter) => parameter.key === 'y');
      Object.assign($(axis + '-speed'), {
        min: speedParameter.min,
        max: speedParameter.max,
        value: speedParameter.default
      });
      Object.assign($(axis + '-steps'), {
        min: stepsParameter.min,
        max: stepsParameter.max,
        value: JOG_PRESET_STEPS[0]
      });
    }

    function notify(message) {
      clearTimeout(toastTimeout);
      $('ui-toast').textContent = message;
      $('ui-toast').hidden = false;
      toastTimeout = setTimeout(() => { $('ui-toast').hidden = true; }, 4500);
    }

    // ------------------------------------------------------------ 1.11.17: real device facts
    // Send one command and collect what the AIRIZ prints for it, until "#INFO#...#END#" or the
    // shell prompt comes back (or the timeout). The reply also appears in the console as usual.
    const INFO_PATTERN = /#INFO#(-?\d+)(?::([^#]*))?#END#/;
    const PROMPT_PATTERN = /(?:^|\n)[^\n#]{0,40}[#$]$/;
    function cleanReply(raw, command) {
      const lines = String(raw).replace(/\r/g, '').split('\n');
      const kept = lines.filter((line, index) => {
        const trimmed = line.trim();
        if (index === 0 && trimmed === command.trim()) return false;
        return !/^[^#]{0,40}[#$]\s*$/.test(trimmed) || trimmed.includes('#INFO#');
      });
      return kept.join('\n').trim();
    }
    function runDeviceCommand(command, options = {}) {
      const timeoutMs = options.timeoutMs || 4000;
      return new Promise((resolve) => {
        let buffer = '';
        let done = false;
        let settle = null;
        let stop = () => {};
        const started = performance.now();
        const finish = (result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearTimeout(settle);
          stop();
          resolve(Object.assign({
            command,
            raw: buffer,
            output: cleanReply(buffer, command),
            ms: Math.round(performance.now() - started)
          }, result));
        };
        stop = api.onOutput((text) => {
          buffer += text;
          const tail = buffer.replace(/\r/g, '').replace(/\s+$/, '');
          if (INFO_PATTERN.test(buffer) || PROMPT_PATTERN.test(tail)) {
            clearTimeout(settle);
            settle = setTimeout(() => finish({ sent: true, timedOut: false }), 150);
          }
        });
        const timer = setTimeout(() => finish({ sent: true, timedOut: true }), timeoutMs);
        api.sendCommand(command, { quiet: !!options.quiet }).then((sent) => {
          if (!sent) finish({ sent: false, timedOut: false });
        });
      });
    }

    // Firmware the connected AIRIZ reports, next to the firmware the command list was written for.
    const COMMANDS_WRITTEN_FOR = window.AIRIZ_COMMANDS.meta.fwVersion;
    let firmwareTimer = null;
    let firmwareToken = 0;
    let reportedFirmware = '';
    function showFirmware(text, state, title) {
      const element = $('fw-version');
      element.textContent = text;
      element.dataset.state = state || '';
      element.title = title || 'Firmware version the connected AIRIZ reports (diag ver sw)';
    }
    function reportFirmware(version, demo) {
      reportedFirmware = version;
      const same = version === COMMANDS_WRITTEN_FOR;
      showFirmware(version + (demo ? ' (demo)' : ''), same ? 'match' : 'differs', same
        ? 'The AIRIZ reports FW ' + version + ', the firmware this command list was written for.'
        : 'The AIRIZ reports FW ' + version + '; the command list was written for FW ' + COMMANDS_WRITTEN_FOR
          + '. Most commands are the same - if one fails, check its reply in the console.');
    }
    function scheduleFirmwareQuery(delayMs = 1500, attempt = 1) {
      clearTimeout(firmwareTimer);
      const token = ++firmwareToken;
      showFirmware('reading\u2026', 'pending');
      firmwareTimer = setTimeout(async () => {
        const status = api.getStatus();
        if (token !== firmwareToken || !status.connected) return;
        if (status.deviceFirmware) {
          reportFirmware(String(status.deviceFirmware), status.demoMode);
          return;
        }
        if (status.macroRunning || status.voiceBusy) {
          if (attempt < 6) scheduleFirmwareQuery(5000, attempt + 1);
          else showFirmware('not read', 'unknown', 'The console was busy. Run diag ver sw to see it.');
          return;
        }
        const reply = await runDeviceCommand('diag ver sw', { quiet: true, timeoutMs: 3000 });
        if (token !== firmwareToken) return;
        const info = INFO_PATTERN.exec(reply.raw);
        if (info && info[1] === '0' && info[2] && info[2].trim()) {
          reportFirmware(info[2].trim(), api.getStatus().demoMode);
        } else if (attempt < 3) {
          scheduleFirmwareQuery(4000, attempt + 1);
        } else {
          showFirmware('no answer', 'unknown', 'The AIRIZ did not answer diag ver sw. Is it at the shell prompt?');
        }
      }, delayMs);
    }
    function forgetFirmware() {
      clearTimeout(firmwareTimer);
      firmwareToken++;
      reportedFirmware = '';
      showFirmware('not connected', '');
    }

    // Bluetooth self-test: "diag ble on" prints the BlueZ controller dump, then #INFO#<code>#END#.
    function parseBluetoothTest(raw) {
      const info = INFO_PATTERN.exec(raw);
      const address = /\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/i.exec(raw);
      return {
        code: info ? Number(info[1]) : null,
        detail: info && info[2] ? info[2].trim() : '',
        address: address ? address[1].toUpperCase() : ''
      };
    }
    function showBluetoothResult(text, state, title) {
      const element = $('ble-test-result');
      element.textContent = text;
      element.dataset.state = state || '';
      element.title = title || '';
    }

    // Link activity: real bytes to / from the AIRIZ console (sidebar bars, header, last reply).
    const link = { tx: 0, rx: 0, history: [], lastRxAt: 0 };
    api.onOutput((text) => {
      link.rx += String(text).length;
      link.lastRxAt = Date.now();
    });
    api.onCommandSent((line) => {
      link.tx += String(line).length + 2;
    });
    function formatRate(bytes) {
      return bytes < 1000 ? bytes + ' B/s' : (bytes / 1000).toFixed(1) + ' kB/s';
    }
    function replyAge(now) {
      if (!link.lastRxAt || link.lastRxAt < connectedAt) return null;
      return Math.max(0, Math.floor((now - link.lastRxAt) / 1000));
    }
    function ageText(seconds) {
      return seconds < 120 ? seconds + ' s' : Math.floor(seconds / 60) + ' min';
    }
    function renderLinkActivity() {
      const now = Date.now();
      const status = api.getStatus();
      link.history.push(link.tx + link.rx);
      if (link.history.length > 12) link.history.shift();
      $('link-rate').textContent = 'TX ' + formatRate(link.tx) + ' \u00b7 RX ' + formatRate(link.rx);
      link.tx = 0;
      link.rx = 0;
      const bars = $('link-wave').children;
      const scale = Math.log10(1 + 12000);
      for (let index = 0; index < bars.length; index += 1) {
        const value = link.history[link.history.length - bars.length + index] || 0;
        bars[index].style.height = (3 + 30 * Math.min(1, Math.log10(1 + value) / scale)).toFixed(1) + 'px';
      }
      $('link-wave').classList.toggle('live', status.connected);
      const age = replyAge(now);
      let lastText;
      let headerText;
      let dotClass = 'signal-dot';
      if (!status.connected) {
        lastText = status.reconnecting ? 'Reconnecting to the AIRIZ\u2026' : 'No AIRIZ connected';
        headerText = status.reconnecting ? 'RECONNECTING\u2026' : 'NOT CONNECTED';
      } else if (status.demoMode) {
        lastText = 'Demo: simulated replies';
        headerText = 'DEMO \u00b7 SIMULATED';
        dotClass += ' demo';
      } else {
        const label = String(status.transportLabel || 'USB serial').toUpperCase();
        lastText = age === null ? 'No reply yet' : 'Last reply ' + ageText(age) + ' ago';
        headerText = label + ' \u00b7 ' + (age === null ? 'NO REPLY YET' : 'LAST REPLY ' + ageText(age).toUpperCase() + ' AGO');
        if (age !== null && age < 60) dotClass += ' active';
      }
      $('link-last').textContent = lastText;
      $('header-link-text').textContent = headerText;
      $('header-link-dot').className = dotClass;
      if (connectedAt && status.connected) {
        const elapsed = Math.floor((now - connectedAt) / 1000);
        const parts = [Math.floor(elapsed / 3600), Math.floor((elapsed % 3600) / 60), elapsed % 60];
        $('session-clock').textContent = parts.map((part) => String(part).padStart(2, '0')).join(':');
      } else {
        $('session-clock').textContent = '--:--:--';
      }
    }

    // Move check: compare small grey camera frames before and after a jog.
    const probe = { video: null, stream: null, canvas: null, last: null, noise: 1.5, checking: 0, token: 0 };
    function probeVideo() {
      const stream = api.getCameraStream();
      if (!stream) {
        if (probe.video && probe.stream) probe.video.srcObject = null;
        probe.stream = null;
        probe.last = null;
        return null;
      }
      if (!probe.video) {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('aria-hidden', 'true');
        video.className = 'motion-probe-video';
        document.body.append(video);
        probe.video = video;
      }
      if (probe.stream !== stream) {
        probe.stream = stream;
        probe.last = null;
        probe.video.srcObject = stream;
        probe.video.play().catch(() => {});
      }
      return probe.video.videoWidth ? probe.video : null;
    }
    function grabGray(video, width = 96) {
      const core = window.AirizPtzCore;
      if (!video || !core) return null;
      const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      if (!probe.canvas) probe.canvas = document.createElement('canvas');
      probe.canvas.width = width;
      probe.canvas.height = height;
      const context = probe.canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, width, height);
      return core.toGray(context.getImageData(0, 0, width, height).data);
    }
    // Idle sampling once a second: how much the picture changes on its own (sensor noise).
    function sampleCameraNoise() {
      const video = probeVideo();
      if (!video || probe.checking || !window.AirizPtzCore) return;
      const gray = grabGray(video);
      if (probe.last && gray && probe.last.length === gray.length) {
        const difference = window.AirizPtzCore.frameDifference(probe.last, gray);
        // ignore big jumps (something moved in front of the camera, a move from another view)
        if (difference < probe.noise * 4 + 3) probe.noise = probe.noise * 0.8 + difference * 0.2;
      }
      probe.last = gray;
    }
    function showMoveCheck(text, state) {
      const element = $('jog-verify');
      element.textContent = text;
      element.dataset.state = state || '';
    }
    function describeJog(direction, steps) {
      const axis = direction.startsWith('pan') ? 'pan' : 'rising';
      return axis + ' ' + (direction.endsWith('fwd') ? 'forward' : 'reverse') + ' ' + steps + ' steps';
    }
    // Call just before a jog is sent. Returns a function that watches the camera after the send.
    function beginMoveCheck(direction, steps, demo) {
      const token = ++probe.token;
      probe.checking = token;
      if (demo) {
        probe.checking = 0;
        showMoveCheck('Move check: demo - there is no real camera move to check.', 'off');
        return null;
      }
      const video = probeVideo();
      const before = grabGray(video);
      if (!before) {
        showMoveCheck('Move check: sent ' + describeJog(direction, steps) + ', not confirmed (camera preview is off).', 'off');
        probe.checking = 0;
        return null;
      }
      const core = window.AirizPtzCore;
      const axis = direction.startsWith('pan') ? 'pan' : 'rising';
      const speed = Number($(axis + '-speed').value) || 1;
      const expectedMs = core.estimateMoveMs(axis, steps, speed);
      const deadline = Math.max(2500, Math.min(9000, expectedMs * 1.5 + 1500));
      const threshold = Math.max(2.5, probe.noise * 3 + 1);
      showMoveCheck('Move check: watching the camera\u2026', 'pending');
      return async () => {
        const started = performance.now();
        let above = 0;
        while (performance.now() - started < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          if (token !== probe.token) return;
          const now = grabGray(probeVideo());
          if (!now || now.length !== before.length) break;
          const difference = core.frameDifference(before, now);
          above = difference > threshold ? above + 1 : 0;
          if (above >= 2) {
            const seconds = ((performance.now() - started) / 1000).toFixed(1);
            showMoveCheck('Move check: the camera picture moved \u2713 (' + describeJog(direction, steps) + ', seen after ' + seconds + ' s).', 'ok');
            probe.checking = 0;
            probe.last = null;
            return;
          }
        }
        if (token !== probe.token) return;
        probe.checking = 0;
        probe.last = null;
        showMoveCheck('Move check: no movement seen in the camera picture for ' + describeJog(direction, steps)
          + '. The command was sent - check the AIRIZ (motor power, end of travel) and that the preview shows the AIRIZ camera.', 'warn');
      };
    }

    function getJogCommand(direction, validate = false, fixedSteps = null) {
      const definition = commandDefinitions.get(direction);
      if (!definition) return null;
      const axis = direction.startsWith('pan') ? 'pan' : 'rising';
      const speedInput = $(axis + '-speed');
      const stepsInput = $(axis + '-steps');
      const speed = Number(speedInput.value);
      const steps = fixedSteps === null ? Number(stepsInput.value) : fixedSteps;
      const valid = speedInput.checkValidity() && (fixedSteps !== null || stepsInput.checkValidity())
        && Number.isInteger(speed) && Number.isInteger(steps)
        && steps >= Number(stepsInput.min) && steps <= Number(stepsInput.max)
        && speed >= Number(speedInput.min) && speed <= Number(speedInput.max);
      if (!valid) {
        if (validate) {
          notify('Enter a whole step count from 1 to 99,999 before jogging.');
          stepsInput.reportValidity();
        }
        return null;
      }
      return definition.cmd.replace('{x}', String(speed)).replace('{y}', String(steps));
    }

    function updateParameters() {
      for (const axis of ['pan', 'rising']) {
        const input = $(axis + '-speed');
        $(axis + '-speed-value').value = String(input.value).padStart(2, '0');
        const percentage = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
        input.style.setProperty('--fill', percentage + '%');
      }
      for (const button of presetButtons) {
        const selected = $('pan-steps').value === button.dataset.steps
          && $('rising-steps').value === button.dataset.steps;
        button.setAttribute('aria-pressed', String(selected));
      }
      $('jog-command-preview').textContent = getJogCommand(previewDirection, false, previewSteps) || 'Enter a valid step count to preview';
    }

    function setKeyboard(enabled) {
      keyboardEnabled = enabled;
      $('keyboard-toggle').setAttribute('aria-pressed', String(enabled));
      $('keyboard-toggle').querySelector('span').textContent = enabled ? 'Keyboard on' : 'Keyboard off';
    }

    function lockJog(showNotice = false) {
      armed = false;
      $('arm-jog').checked = false;
      setKeyboard(false);
      if (showNotice) notify('Manual jog locked. An already-sent motor move is not stopped.');
      updateAvailability();
    }

    function unlockJog() {
      armed = api.getStatus().connected;
      $('arm-jog').checked = armed;
      setKeyboard(armed && localStorage.getItem('airiz.keyboard.enabled') !== '0');
      updateAvailability();
    }

    function updateAvailability() {
      const status = api.getStatus();
      const canJog = currentView === 'controller' && status.connected && armed
        && !status.macroRunning && !busy;
      jogButtons.forEach(button => { button.disabled = !canJog; });
      fullTravelButtons.forEach(button => { button.disabled = !canJog; });
      $('arm-jog').disabled = !status.connected;
      $('keyboard-toggle').disabled = !status.connected;
      $('btn-send-raw').disabled = !status.connected;
      $('btn-bluetooth-on').disabled = !status.connected || status.macroRunning || bluetoothSending;
      $('btn-hardware-check').disabled = !status.connected || status.macroRunning || hardwareCheckRunning;
      $('hwcheck-run').disabled = !status.connected || status.macroRunning || hardwareCheckRunning;
      const armTitle = !status.connected ? 'Connect to enable jogging'
        : armed ? (status.demoMode ? 'Demo jog enabled' : 'Jog enabled') : 'Jog manually locked';
      const armDescription = !status.connected
        ? 'Connecting enables the jog pad and arrow keys. No motion is sent automatically.'
        : status.macroRunning
          ? 'Macro running: manual jogs are temporarily paused. Your jog and keyboard settings are kept.'
          : !armed
            ? 'Click this switch or Keyboard on to unlock. Locking prevents new jogs only.'
            : status.demoMode
              ? 'Simulated device only. One click or arrow-key press sends one finite jog. No hardware moves.'
              : 'Ready after connection. One click or arrow-key press sends one finite jog. Tab changes and focus loss do not lock it.';
      if ($('arm-title').textContent !== armTitle) $('arm-title').textContent = armTitle;
      if ($('arm-description').textContent !== armDescription) $('arm-description').textContent = armDescription;
    }

    function refreshStatus() {
      const status = api.getStatus();
      const connectionKey = String(status.connected) + ':' + String(status.demoMode) + ':' + String(!!status.reconnecting);
      if (connectionKey !== lastConnection) {
        lastConnection = connectionKey;
        if (status.connected) {
          unlockJog();
          connectedAt = Date.now();
          link.lastRxAt = 0;
          scheduleFirmwareQuery();
        } else {
          lockJog();
          connectedAt = 0;
          forgetFirmware();
          showBluetoothResult('not run', '');
        }
        $('sidebar-status').textContent = status.demoMode && status.connected
          ? 'Demo · no hardware'
          : status.connected ? (status.transportLabel || 'USB serial') + ' connected'
            : status.reconnecting ? 'Reconnecting to the AIRIZ…' : 'Waiting for connection';
        $('transport-note').textContent = status.demoMode && status.connected
          ? 'Simulator active. No commands are sent to hardware.'
          : status.connected
            ? (/^(Bluetooth|Remote)/.test(status.transportLabel || '')
              ? status.transportLabel + (status.deviceFirmware ? ' · FW ' + status.deviceFirmware : '')
              : status.baudRate.toLocaleString() + ' baud · 8N1 · USB serial')
            : window.airizMobile ? 'Discover and verify a Bluetooth command channel, or try Demo.' : 'Connect over USB serial, or try the simulator.';
        $('motion-mode').textContent = status.demoMode && status.connected ? 'DEMO / SIMULATED' : 'MANUAL JOG';
        $('stage-state').textContent = status.demoMode && status.connected
          ? 'SIMULATOR READY' : status.connected ? 'SERIAL CONNECTED' : status.reconnecting ? 'RECONNECTING' : 'STANDBY';
        for (const id of ['sidebar-dot', 'stage-dot']) {
          $(id).className = 'signal-dot' + (status.connected ? status.demoMode ? ' demo' : ' active' : '');
        }
        if (status.demoMode && status.connected) notify('Demo is ready. Try the jog pad — no hardware required.');
      }
      updateAvailability();
    }

    async function jog(direction, fixedSteps = null) {
      const status = api.getStatus();
      if (busy || currentView !== 'controller' || !status.connected || status.macroRunning) return;
      if (!armed) {
        notify('Jog is manually locked. Click the switch or Keyboard on to unlock.');
        return;
      }
      previewDirection = direction;
      previewSteps = fixedSteps;
      updateParameters();
      const command = getJogCommand(direction, true, fixedSteps);
      if (!command) return;
      busy = true;
      updateAvailability();
      try {
        const steps = fixedSteps === null ? Number($((direction.startsWith('pan') ? 'pan' : 'rising') + '-steps').value) : fixedSteps;
        const watchCamera = beginMoveCheck(direction, steps, status.demoMode);
        const sent = await api.sendCommand(command);
        if (!sent) {
          probe.checking = 0;
          showMoveCheck('Move check: the command was not sent.', 'warn');
          notify('Command not sent. Check the live console for details.');
          return;
        }
        if (watchCamera) watchCamera();
        const stage = $('motion-stage');
        stage.dataset.direction = direction.startsWith('pan')
          ? (direction === panCommandFor('left') ? 'pan-left' : 'pan-right')
          : direction;
        $('stage-state').textContent = status.demoMode ? 'SIMULATED COMMAND' : 'SENT · COMPLETION UNVERIFIED';
        const button = fixedSteps === null
          ? jogButtons.find((item) => item.dataset.jog === direction)
          : fullTravelButtons.find((item) => item.dataset.fullTravel === direction);
        jogButtons.concat(fullTravelButtons).forEach((item) => item.classList.remove('key-active'));
        button.classList.add('key-active');
        if (fixedSteps !== null) {
          notify((direction === 'rising-fwd' ? 'Full rise sent: ' : 'Full down sent: ') + fixedSteps
            + ' steps. Let the camera finish before the next move.');
        }
        clearTimeout(animationTimeout);
        animationTimeout = setTimeout(() => {
          delete stage.dataset.direction;
          jogButtons.concat(fullTravelButtons).forEach((item) => item.classList.remove('key-active'));
          const current = api.getStatus();
          $('stage-state').textContent = current.connected
            ? current.demoMode ? 'SIMULATOR READY' : 'SERIAL CONNECTED'
            : 'STANDBY';
        }, 700);
      } catch (error) {
        notify('Command failed: ' + error.message);
      } finally {
        // Debounce clicks only; this is not a motion-complete timer.
        setTimeout(() => {
          busy = false;
          updateAvailability();
        }, 350);
      }
    }

    function showView(view) {
      if (!views[view]) view = 'controller';
      currentView = view;
      for (const name of Object.keys(views)) {
        $('view-' + name).hidden = name !== view;
        $('tab-' + name).setAttribute('aria-selected', String(name === view));
        $('tab-' + name).tabIndex = name === view ? 0 : -1;
      }
      $('page-title').textContent = views[view][0];
      const dot = document.createElement('span');
      dot.className = 'title-dot';
      dot.textContent = '.';
      $('page-title').append(dot);
      $('page-description').textContent = views[view][1];
      $('breadcrumb-view').textContent = views[view][0];
      if (view === 'controller') $('controller-terminal-dock').append(originalTerminal);
      if (view === 'console') $('workbench-terminal-dock').append(originalTerminal);
      updateAvailability();
    }

    Object.keys(views).forEach((view) => {
      const tab = $('tab-' + view);
      tab.setAttribute('aria-label', views[view][0]);
      tab.title = views[view][0];
      tab.addEventListener('click', () => showView(view));
    });
    document.querySelector('.brand').addEventListener('click', (event) => {
      event.preventDefault();
      showView('controller');
    });
    document.querySelector('.side-nav').addEventListener('keydown', (event) => {
      const tabIds = Object.keys(views);
      const currentIndex = tabIds.indexOf(currentView);
      let nextIndex;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabIds.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex + tabIds.length - 1) % tabIds.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabIds.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      const tab = $('tab-' + tabIds[nextIndex]);
      tab.click();
      tab.focus();
    });

    jogButtons.forEach((button) => {
      button.addEventListener('click', () => jog(button.dataset.jog));
      for (const eventName of ['pointerenter', 'focus']) {
        button.addEventListener(eventName, () => {
          previewDirection = button.dataset.jog;
          previewSteps = null;
          updateParameters();
        });
      }
    });
    applyPanArrows();
    document.querySelectorAll('[data-pan-swap]').forEach((button) => {
      button.addEventListener('click', () => {
        setPanArrowsOpposite(!panArrowsOpposite());
        notify(panArrowsOpposite()
          ? 'Left/right now opposite: left sends pan reverse (old mapping).'
          : 'Left/right now the same direction: left turns the camera left.');
      });
    });
    window.addEventListener('storage', (event) => {
      if (event.key === PAN_SWAP_KEY) applyPanArrows();
    });
    $('full-travel-steps').textContent = FULL_TRAVEL_STEPS + ' steps';
    fullTravelButtons.forEach((button) => {
      button.addEventListener('click', () => jog(button.dataset.fullTravel, FULL_TRAVEL_STEPS));
      for (const eventName of ['pointerenter', 'focus']) {
        button.addEventListener(eventName, () => {
          previewDirection = button.dataset.fullTravel;
          previewSteps = FULL_TRAVEL_STEPS;
          updateParameters();
        });
      }
    });
    jogInputIds.forEach((id) => $(id).addEventListener('input', updateParameters));
    presetButtons.forEach((button) => button.addEventListener('click', () => {
      $('pan-steps').value = button.dataset.steps;
      $('rising-steps').value = button.dataset.steps;
      updateParameters();
    }));

    $('arm-jog').addEventListener('change', () => {
      if ($('arm-jog').checked) unlockJog();
      else lockJog(true);
    });
    $('keyboard-toggle').addEventListener('click', () => {
      if (!api.getStatus().connected) return;
      const next = !keyboardEnabled;
      if (next) {
        armed = true;
        $('arm-jog').checked = true;
      }
      localStorage.setItem('airiz.keyboard.enabled', next ? '1' : '0');
      setKeyboard(next);
      updateAvailability();
      notify(next ? 'Arrow keys are ready on the Motor control view. One press sends one finite jog.' : 'Keyboard jogging is off. The jog pad remains available.');
    });
    $('btn-disconnect').addEventListener('click', () => lockJog(), true);
    // No focus, visibility, view-change or macro-start auto-lock. Key events still
    // require the active controller view, focused app and no editing field/dialog.
    $('btn-bluetooth-on').addEventListener('click', async () => {
      const status = api.getStatus();
      if (!status.connected || status.macroRunning || bluetoothSending) return;
      bluetoothSending = true;
      updateAvailability();
      showBluetoothResult('running\u2026', 'pending');
      try {
        // 1.11.17: read the result instead of only sending the command.
        const reply = await runDeviceCommand(commandDefinitions.get('ble-on').cmd, { timeoutMs: 12000 });
        if (!reply.sent) {
          showBluetoothResult('not sent', 'failed');
          notify('Bluetooth test was not sent. Check the console.');
          return;
        }
        const result = parseBluetoothTest(reply.raw);
        const time = new Date().toLocaleTimeString();
        if (result.code === 0) {
          showBluetoothResult('OK' + (result.address ? ' \u00b7 ' + result.address : ''), 'ok',
            'diag ble on answered #INFO#0 at ' + time + (result.address ? '. Controller address ' + result.address + '.' : '.'));
          notify('Bluetooth self-test passed' + (result.address ? ': controller ' + result.address : '')
            + '. This is a firmware test only - a phone connects through Phone remote \u2192 Start remote (AIRIZ-BT).');
        } else if (result.code !== null) {
          showBluetoothResult('failed (code ' + result.code + ')', 'failed',
            'diag ble on answered #INFO#' + result.code + (result.detail ? ':' + result.detail : '') + ' at ' + time + '. See the console for the BlueZ output.');
          notify('Bluetooth self-test failed (code ' + result.code + '). The console shows the BlueZ output.');
        } else {
          showBluetoothResult('no result', 'unknown', 'No #INFO# answer within 12 s. See the console.');
          notify('The Bluetooth test gave no result within 12 s. Check the console.');
        }
      } finally {
        bluetoothSending = false;
        updateAvailability();
      }
    });

    // ------------------------------------------------------------ 1.11.17: hardware check (read-only)
    const MOTOR_DIR = '/sys/devices/platform/soc/soc:motor';
    const MOTOR_DUMP = 'for f in ' + MOTOR_DIR + '/*; do [ -f "$f" ] && echo "$(basename "$f") = $(cat "$f" 2>&1)"; done';
    const commandText = (id, fallback) => (commandDefinitions.get(id) || { cmd: fallback }).cmd;
    const HARDWARE_STEPS = [
      { key: 'fw', label: 'Firmware version', command: 'diag ver sw' },
      { key: 'kernel', label: 'Kernel', command: 'uname -a' },
      { key: 'motorFiles', label: 'Motor driver files', command: 'ls -l ' + MOTOR_DIR + '/' },
      { key: 'motorValues', label: 'Motor driver values', command: MOTOR_DUMP },
      { key: 'accId', label: 'Accelerometer ID', command: commandText('acc-id', 'diag acc id') },
      { key: 'acc1', label: 'Accelerometer reading 1', command: commandText('acc-attr', 'diag acc attr') },
      { key: 'acc2', label: 'Accelerometer reading 2', command: commandText('acc-attr', 'diag acc attr'), pauseMs: 400 },
      { key: 'acc3', label: 'Accelerometer reading 3', command: commandText('acc-attr', 'diag acc attr'), pauseMs: 400 },
      { key: 'risingSwitch', label: 'Rising bottom switch', command: commandText('btn-rising', 'diag button get rising-det') },
      { key: 'syncButton', label: 'Sync button', command: commandText('btn-sync', 'diag button get sync-btn') },
      { key: 'alsId', label: 'Light sensor ID', command: commandText('als-id', 'diag als id') },
      { key: 'alsValue', label: 'Light sensor value', command: commandText('als-value', 'diag als value') },
      { key: 'storage', label: 'Storage (/tmp)', command: 'df -h /tmp' },
      { key: 'video', label: 'Video devices on the AIRIZ', command: 'ls /dev/video* 2>&1' }
    ];
    let hardwareReport = '';

    function infoValue(reply) {
      const info = reply && INFO_PATTERN.exec(reply.raw);
      if (!info) return null;
      return { code: Number(info[1]), value: (info[2] || '').trim() };
    }

    async function readCameraControls() {
      const lines = [];
      const facts = { zoom: null, label: '' };
      const stream = api.getCameraStream();
      const track = stream && stream.getVideoTracks()[0];
      if (!track) {
        lines.push('Camera preview is off: start it on the Camera tab to include the camera controls.');
        return { lines, facts };
      }
      const describe = (capabilities, settings) => {
        for (const name of ['width', 'height', 'frameRate', 'zoom', 'pan', 'tilt', 'focusMode', 'focusDistance', 'exposureMode', 'whiteBalanceMode', 'brightness', 'sharpness', 'torch']) {
          if (!(name in capabilities) && !(name in settings)) continue;
          const capability = capabilities[name];
          const range = capability && typeof capability === 'object' && 'min' in capability
            ? capability.min + '..' + capability.max + (capability.step ? ' step ' + capability.step : '')
            : Array.isArray(capability) ? capability.join('/') : capability === undefined ? '-' : String(capability);
          lines.push('  ' + name + ': now ' + (settings[name] === undefined ? '-' : settings[name]) + ', range ' + range);
        }
      };
      facts.label = track.label || 'camera';
      lines.push('Camera: ' + facts.label);
      const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
      describe(capabilities, track.getSettings ? track.getSettings() : {});
      if (capabilities.zoom) facts.zoom = capabilities.zoom;
      // Browsers only show pan / tilt / zoom when they are asked for: open the same camera once
      // more with those requested, read the controls, and close it again.
      const deviceId = track.getSettings ? track.getSettings().deviceId : '';
      if (!facts.zoom && deviceId && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let ptzStream = null;
        try {
          ptzStream = await Promise.race([
            navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, pan: true, tilt: true, zoom: true } }),
            new Promise((resolve, reject) => setTimeout(() => reject(new Error('timed out')), 5000))
          ]);
          const ptzTrack = ptzStream.getVideoTracks()[0];
          const ptzCapabilities = ptzTrack.getCapabilities ? ptzTrack.getCapabilities() : {};
          const offered = ['zoom', 'pan', 'tilt'].filter((name) => name in ptzCapabilities);
          lines.push('  Pan/tilt/zoom request: ' + (offered.length ? 'offered ' + offered.map((name) => name + ' ' + ptzCapabilities[name].min + '..' + ptzCapabilities[name].max).join(', ') : 'none offered by the camera'));
          if (ptzCapabilities.zoom) facts.zoom = ptzCapabilities.zoom;
        } catch (error) {
          lines.push('  Pan/tilt/zoom request: could not ask (' + (error && error.message ? error.message : error) + ')');
        } finally {
          if (ptzStream) ptzStream.getTracks().forEach((item) => item.stop());
        }
      }
      return { lines, facts };
    }

    function summarize(results, camera, status) {
      const summary = [];
      const fw = infoValue(results.fw);
      summary.push('Firmware: ' + (fw && fw.code === 0 ? fw.value : 'no answer') + ' (console commands written for FW ' + COMMANDS_WRITTEN_FOR + ')');
      const motorFiles = results.motorFiles && results.motorFiles.output
        ? results.motorFiles.output.split('\n').map((line) => line.trim().split(/\s+/).pop()).filter((name) => name && !/^total$/i.test(name) && !/^\d+$/.test(name))
        : [];
      summary.push('Motor driver files: ' + (motorFiles.length ? motorFiles.join(', ') : 'none listed'));
      const motorValues = results.motorValues ? results.motorValues.output : '';
      const statusLine = /^status = (.*)$/m.exec(motorValues || '');
      if (statusLine) summary.push('Motor "status" file reads: ' + statusLine[1].trim() + (results.moveDuring ? '' : ' (idle)'));
      if (results.moveDuring) {
        const during = /^status = (.*)$/m.exec(results.moveDuring.output || '');
        const after = /^status = (.*)$/m.exec(results.moveAfter ? results.moveAfter.output : '');
        summary.push('Motor "status" during the test move: ' + (during ? during[1].trim() : '-') + ', after: ' + (after ? after[1].trim() : '-')
          + (during && after && during[1].trim() !== after[1].trim() ? ' -> it changes while moving: the console could read "move finished" from it.' : ' -> no change seen.'));
      }
      const accReadings = ['acc1', 'acc2', 'acc3'].map((key) => results[key] && results[key].output).filter(Boolean);
      const accAnswered = accReadings.some((text) => /#INFO#0/.test(text) || /\d/.test(text.replace(/#INFO#-?\d+/g, '')));
      summary.push('Accelerometer: ' + (accAnswered
        ? 'answers (' + (new Set(accReadings).size > 1 ? 'readings change between reads' : 'same reading 3 times') + ') - could show tilt / knocks; see the raw readings below.'
        : 'no usable answer.'));
      const rising = infoValue(results.risingSwitch);
      summary.push('Rising bottom switch: ' + (rising ? rising.value || 'code ' + rising.code : 'no answer'));
      const lux = infoValue(results.alsValue);
      summary.push('Light sensor: ' + (lux ? lux.value || 'code ' + lux.code : 'no answer'));
      summary.push('Camera zoom: ' + (camera.facts.zoom
        ? 'the camera offers zoom ' + camera.facts.zoom.min + '..' + camera.facts.zoom.max + ' to this PC - a real zoom control is possible.'
        : camera.facts.label ? 'no zoom control offered by "' + camera.facts.label + '" - zoom stays digital.' : 'not checked (camera preview off).'));
      if (status.demoMode) summary.unshift('DEMO MODE: the answers below come from the simulator, not from an AIRIZ.');
      return summary;
    }

    async function runHardwareCheck() {
      const status = api.getStatus();
      if (!status.connected || status.macroRunning || hardwareCheckRunning) return;
      hardwareCheckRunning = true;
      updateAvailability();
      $('hwcheck-copy').disabled = true;
      $('hwcheck-save').disabled = true;
      const results = {};
      const log = [];
      const steps = HARDWARE_STEPS.slice();
      const withMove = $('hwcheck-move').checked;
      try {
        for (let index = 0; index < steps.length; index += 1) {
          const step = steps[index];
          if (!api.getStatus().connected) throw new Error('The AIRIZ disconnected.');
          $('hwcheck-status').textContent = 'Reading ' + (index + 1) + ' of ' + steps.length + (withMove ? ' (+ test move)' : '') + ': ' + step.label + '\u2026';
          if (step.pauseMs) await new Promise((resolve) => setTimeout(resolve, step.pauseMs));
          const reply = await runDeviceCommand(step.command, { timeoutMs: 5000 });
          results[step.key] = reply;
          log.push({ label: step.label, reply });
        }
        if (withMove) {
          const panForward = commandDefinitions.get('pan-fwd').cmd.replace('{x}', '1').replace('{y}', '20');
          const panReverse = commandDefinitions.get('pan-rev').cmd.replace('{x}', '1').replace('{y}', '20');
          $('hwcheck-status').textContent = 'Test move: pan 20 steps forward, reading the motor files during the move\u2026';
          if (await api.sendCommand(panForward)) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            results.moveDuring = await runDeviceCommand(MOTOR_DUMP, { timeoutMs: 4000 });
            log.push({ label: 'Motor driver values DURING a 20-step pan move', reply: results.moveDuring });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            results.moveAfter = await runDeviceCommand(MOTOR_DUMP, { timeoutMs: 4000 });
            log.push({ label: 'Motor driver values AFTER the move', reply: results.moveAfter });
            await api.sendCommand(panReverse);
          }
        }
        $('hwcheck-status').textContent = 'Reading the camera controls\u2026';
        const camera = await readCameraControls();
        const now = new Date();
        const lines = [
          'AIRIZ hardware check - ' + now.toLocaleString(),
          'Link: ' + (status.demoMode ? 'demo (simulated)' : status.transportLabel || 'USB serial') + (status.connected && !status.demoMode && status.baudRate ? ' @ ' + status.baudRate + ' baud' : ''),
          '',
          '== Summary ==',
          ...summarize(results, camera, status).map((line) => '- ' + line),
          '',
          '== Camera controls (this PC) ==',
          ...camera.lines,
          '',
          '== Raw answers =='
        ];
        for (const entry of log) {
          const reply = entry.reply;
          lines.push('');
          lines.push('[' + entry.label + ']  $ ' + reply.command + '   (' + (reply.sent ? (reply.timedOut ? 'no prompt after ' : '') + (reply.ms / 1000).toFixed(1) + ' s' : 'not sent') + ')');
          lines.push(reply.output || '(no answer)');
        }
        hardwareReport = lines.join('\n');
        $('hwcheck-report').textContent = hardwareReport;
        $('hwcheck-status').textContent = 'Done. Save the report and send it to the Ziris PTB team.';
        $('hwcheck-copy').disabled = false;
        $('hwcheck-save').disabled = false;
      } catch (error) {
        $('hwcheck-status').textContent = 'Stopped: ' + (error && error.message ? error.message : error);
      } finally {
        hardwareCheckRunning = false;
        updateAvailability();
      }
    }

    $('btn-hardware-check').addEventListener('click', () => {
      $('hwcheck-dialog').showModal();
      updateAvailability();
    });
    $('hwcheck-close').addEventListener('click', () => $('hwcheck-dialog').close());
    $('hwcheck-run').addEventListener('click', runHardwareCheck);
    $('hwcheck-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(hardwareReport);
        $('hwcheck-status').textContent = 'Report copied.';
      } catch (error) {
        $('hwcheck-status').textContent = 'Could not copy: select the report text and press Ctrl+C.';
      }
    });
    $('hwcheck-save').addEventListener('click', () => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const url = URL.createObjectURL(new Blob([hardwareReport + '\n'], { type: 'text/plain' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'airiz-hardware-check-' + stamp + '.txt';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      $('hwcheck-status').textContent = 'Report saved as ' + anchor.download + '.';
    });

    function openHelp() {
      $('shortcuts-dialog').showModal();
    }
    $('btn-shortcuts').addEventListener('click', openHelp);
    $('btn-shortcuts-mobile').addEventListener('click', openHelp);
    $('close-shortcuts').addEventListener('click', () => $('shortcuts-dialog').close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (document.querySelector('dialog[open]')) return;
        lockJog(keyboardEnabled || armed);
        // Escape also halts a move in progress (motor driver stop).
        if (api.getStatus().connected && typeof api.stopMotor === 'function') api.stopMotor();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target.closest('input, textarea, select, [contenteditable="true"], .side-nav')) return;
      if (event.key === '?') {
        event.preventDefault();
        openHelp();
        return;
      }
      if (event.key === '/' && (currentView === 'controller' || currentView === 'console')) {
        event.preventDefault();
        $('raw-command').focus();
        return;
      }
      const directions = {
        ArrowUp: 'rising-fwd',
        ArrowDown: 'rising-rev',
        ArrowLeft: panCommandFor('left'),
        ArrowRight: panCommandFor('right')
      };
      if (keyboardEnabled && armed && document.hasFocus() && !document.hidden
          && currentView === 'controller' && directions[event.key]) {
        event.preventDefault();
        jog(directions[event.key]);
      }
    });

    $('btn-send-raw').addEventListener('click', () => {
      $('raw-command').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      $('raw-command').focus();
    });
    $('raw-command').addEventListener('keydown', (event) => {
      const input = $('raw-command');
      if (event.key === 'Enter' && input.value.trim()) {
        if (history[history.length - 1] !== input.value.trim()) history.push(input.value.trim());
        if (history.length > 100) history.shift();
        historyIndex = history.length;
        historyDraft = '';
      } else if (event.key === 'ArrowUp' && history.length) {
        event.preventDefault();
        if (historyIndex === history.length) historyDraft = input.value;
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex];
      } else if (event.key === 'ArrowDown' && history.length) {
        event.preventDefault();
        historyIndex = Math.min(history.length, historyIndex + 1);
        input.value = historyIndex === history.length ? historyDraft : history[historyIndex];
      }
    }, true);
    $('console-filter').addEventListener('change', () => {
      consoleOutput.dataset.filter = $('console-filter').value;
    });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.classList.contains('command')) transmitted++;
          if (node.classList.contains('response')) received++;
        }
      }
      $('tx-count').textContent = String(transmitted).padStart(2, '0');
      $('rx-count').textContent = String(received).padStart(2, '0');
    }).observe(consoleOutput, { childList: true });
    new MutationObserver(refreshStatus).observe($('connection-status'), { childList: true, attributes: true });
    new MutationObserver(refreshStatus).observe($('macro-progress'), { childList: true, subtree: true });

    function updateThemeMeta() {
      $('theme-color-meta').content = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
    }
    new MutationObserver(updateThemeMeta).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeMeta);
    $('reference-fw').textContent = window.AIRIZ_COMMANDS.meta.fwVersion;
    $('data-source').textContent = COMMANDS_WRITTEN_FOR;
    $('data-source').title = 'From ' + window.AIRIZ_COMMANDS.meta.source;
    setInterval(() => {
      refreshStatus();
      renderLinkActivity();
      sampleCameraNoise();
    }, 1000);
    renderLinkActivity();
    showView('controller');
    refreshStatus();
    updateParameters();
    updateThemeMeta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
})();
