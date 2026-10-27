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
      sfx: ['Sound laboratory', 'Explore synthesized sounds, playback, and audio experiments.']
    };
    const commandDefinitions = new Map(
      window.AIRIZ_COMMANDS.groups.flatMap((group) => group.commands).map((command) => [command.id, command])
    );
    const jogButtons = [...document.querySelectorAll('[data-jog]')];
    const presetButtons = [...document.querySelectorAll('[data-steps]')];
    const jogInputIds = ['pan-speed', 'pan-steps', 'rising-speed', 'rising-steps'];
    const originalTerminal = document.querySelector('.panel-console');
    const consoleOutput = $('console-output');
    let currentView = 'controller';
    let previewDirection = 'pan-fwd';
    let armed = false;
    let keyboardEnabled = false;
    let busy = false;
    let lastConnection = '';
    let bluetoothSending = false;
    let toastTimeout;
    let animationTimeout;
    let transmitted = 0;
    let received = 0;
    const startedAt = Date.now();
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
        value: 1
      });
    }

    function notify(message) {
      clearTimeout(toastTimeout);
      $('ui-toast').textContent = message;
      $('ui-toast').hidden = false;
      toastTimeout = setTimeout(() => { $('ui-toast').hidden = true; }, 4500);
    }

    function getJogCommand(direction, validate = false) {
      const definition = commandDefinitions.get(direction);
      if (!definition) return null;
      const axis = direction.startsWith('pan') ? 'pan' : 'rising';
      const speedInput = $(axis + '-speed');
      const stepsInput = $(axis + '-steps');
      const speed = Number(speedInput.value);
      const steps = Number(stepsInput.value);
      const valid = speedInput.checkValidity() && stepsInput.checkValidity()
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
      $('jog-command-preview').textContent = getJogCommand(previewDirection) || 'Enter a valid step count to preview';
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
      $('arm-jog').disabled = !status.connected;
      $('keyboard-toggle').disabled = !status.connected;
      $('btn-send-raw').disabled = !status.connected;
      $('btn-bluetooth-on').disabled = !status.connected || status.macroRunning || bluetoothSending;
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
      const connectionKey = String(status.connected) + ':' + String(status.demoMode);
      if (connectionKey !== lastConnection) {
        lastConnection = connectionKey;
        if (status.connected) unlockJog();
        else lockJog();
        $('sidebar-status').textContent = status.demoMode && status.connected
          ? 'Demo · no hardware'
          : status.connected ? (status.transportLabel || 'USB serial') + ' connected' : 'Waiting for connection';
        $('transport-note').textContent = status.demoMode && status.connected
          ? 'Simulator active. No commands are sent to hardware.'
          : status.connected
            ? (/^(Bluetooth|Remote)/.test(status.transportLabel || '')
              ? status.transportLabel + (status.deviceFirmware ? ' · FW ' + status.deviceFirmware : '')
              : status.baudRate.toLocaleString() + ' baud · 8N1 · USB serial')
            : window.airizMobile ? 'Discover and verify a Bluetooth command channel, or try Demo.' : 'Connect over USB serial, or try the simulator.';
        $('motion-mode').textContent = status.demoMode && status.connected ? 'DEMO / SIMULATED' : 'MANUAL JOG';
        $('stage-state').textContent = status.demoMode && status.connected
          ? 'SIMULATOR READY' : status.connected ? 'SERIAL CONNECTED' : 'STANDBY';
        for (const id of ['sidebar-dot', 'stage-dot']) {
          $(id).className = 'signal-dot' + (status.connected ? status.demoMode ? ' demo' : ' active' : '');
        }
        if (status.demoMode && status.connected) notify('Demo is ready. Try the jog pad — no hardware required.');
      }
      updateAvailability();
    }

    async function jog(direction) {
      const status = api.getStatus();
      if (busy || currentView !== 'controller' || !status.connected || status.macroRunning) return;
      if (!armed) {
        notify('Jog is manually locked. Click the switch or Keyboard on to unlock.');
        return;
      }
      previewDirection = direction;
      updateParameters();
      const command = getJogCommand(direction, true);
      if (!command) return;
      busy = true;
      updateAvailability();
      try {
        const sent = await api.sendCommand(command);
        if (!sent) {
          notify('Command not sent. Check the live console for details.');
          return;
        }
        const stage = $('motion-stage');
        stage.dataset.direction = direction;
        $('stage-state').textContent = status.demoMode ? 'SIMULATED COMMAND' : 'SENT · COMPLETION UNVERIFIED';
        const button = jogButtons.find((item) => item.dataset.jog === direction);
        jogButtons.forEach((item) => item.classList.remove('key-active'));
        button.classList.add('key-active');
        clearTimeout(animationTimeout);
        animationTimeout = setTimeout(() => {
          delete stage.dataset.direction;
          jogButtons.forEach((item) => item.classList.remove('key-active'));
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
      try {
        const sent = await api.sendCommand(commandDefinitions.get('ble-on').cmd);
        notify(sent
          ? 'Sent "diag ble on" (firmware Bluetooth test only). To control the device from a phone, use Phone remote \u2192 Start remote instead; the phone then sees AIRIZ-BT.'
          : 'Bluetooth command was not sent. Check the console.');
      } finally {
        bluetoothSending = false;
        updateAvailability();
      }
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
        ArrowLeft: 'pan-rev',
        ArrowRight: 'pan-fwd'
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
    setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      $('session-clock').textContent = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
      refreshStatus();
    }, 1000);
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
