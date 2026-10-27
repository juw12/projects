/* Optional Windows host integration. The same UI remains usable in a browser. */
(() => {
  'use strict';
  if (window.airizMobile) return;
  const host = window.airizDesktop;
  if (!host) {
    async function refreshDesktopLinks() {
      try {
        const response = await fetch('./updates/windows/release.json', { cache: 'no-store' });
        if (!response.ok) return;
        const release = await response.json();
        if (!/^\d+\.\d+\.\d+$/.test(release.version)) return;
        const base = 'https://github.com/juw12/projects/releases/download/airiz-desktop-v' + release.version + '/';
        const installer = base + 'AIRIZ-Console-Setup-' + release.version + '-x64.exe';
        const portable = base + 'AIRIZ-Console-Portable-' + release.version + '-x64.exe';
        if (release.installer.url !== installer || release.portable.url !== portable) return;
        document.getElementById('download-windows-installer').href = installer;
        document.getElementById('download-windows-portable').href = portable;
        document.querySelector('.desktop-download-copy strong').textContent = 'Get the Windows desktop app · v' + release.version;
      } catch {
        // Retain the last known download links if the version feed is offline.
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshDesktopLinks);
    else refreshDesktopLinks();
    return;
  }

  function initializeDesktop() {
    document.documentElement.classList.add('desktop-edition');
    const downloadPanel = document.getElementById('desktop-download-banner');
    if (downloadPanel) downloadPanel.hidden = true;
    document.getElementById('btn-install-app').hidden = true;

    initializeUpdates();
    initializeBluetoothCheck();
    initializeBluetoothPicker();
    restoreConnectionAfterUpdate();
    host.getAppInfo().then(info => {
      document.title = 'AIRIZ Console — Windows ' + info.version;
      const badge = document.querySelector('.header-session');
      if (badge) badge.textContent = 'WINDOWS APP / ' + info.version;
      const footer = document.querySelector('.sidebar-footer');
      if (footer) footer.textContent = 'LOCAL DESKTOP EDITION';
    });

    const chooser = document.createElement('dialog');
    chooser.id = 'native-serial-dialog';
    chooser.className = 'help-dialog native-serial-dialog';
    chooser.setAttribute('aria-labelledby', 'native-serial-title');
    const title = document.createElement('h2');
    title.id = 'native-serial-title';
    title.textContent = 'Choose your serial device';
    const description = document.createElement('p');
    description.textContent = 'Select the connected AIRIZ serial port. No port is selected automatically. The list updates while this dialog is open.';
    const list = document.createElement('div');
    list.id = 'native-serial-list';
    list.className = 'native-serial-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Available serial ports');
    const cancel = document.createElement('button');
    cancel.id = 'native-serial-cancel';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel connection';
    chooser.append(title, description, list, cancel);
    document.body.append(chooser);

    function cancelSelection() {
      host.chooseSerialPort('');
      if (chooser.open) chooser.close();
    }
    cancel.addEventListener('click', cancelSelection);
    chooser.addEventListener('cancel', event => {
      event.preventDefault();
      cancelSelection();
    });
    host.onSerialPorts(({ ports }) => {
      list.replaceChildren();
      if (!ports.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No serial devices found. Connect the AIRIZ USB serial interface and check its Windows driver. You can cancel and use Demo mode without hardware.';
        list.append(empty);
      }
      for (const port of ports) {
        const button = document.createElement('button');
        button.className = 'native-serial-port';
        button.dataset.portId = port.id;
        const name = document.createElement('strong');
        name.textContent = port.name;
        const details = document.createElement('span');
        details.textContent = [port.port, port.vendorId ? 'VID ' + port.vendorId : '', port.productId ? 'PID ' + port.productId : ''].filter(Boolean).join(' · ');
        button.append(name, details);
        button.addEventListener('click', async () => {
          const selected = await host.chooseSerialPort(port.id);
          if (selected) chooser.close();
        });
        list.append(button);
      }
      if (!chooser.open) chooser.showModal();
    });
  }

  function initializeUpdates() {
    const button = document.createElement('button');
    button.id = 'btn-app-updates';
    button.className = 'theme-switcher';
    button.textContent = 'Updates';
    document.querySelector('.header-meta').append(button);
    const modal = document.createElement('dialog');
    modal.id = 'desktop-updates-dialog';
    modal.className = 'help-dialog';
    modal.setAttribute('aria-labelledby', 'desktop-updates-title');
    modal.innerHTML = '<h2 id="desktop-updates-title">AIRIZ updates</h2>'
      + '<p id="desktop-update-version"></p><p id="desktop-update-message" role="status"></p>'
      + '<progress id="desktop-update-progress" max="100" value="0" hidden></progress>'
      + '<p class="desktop-update-note">Checks run automatically. You can install while connected: the port closes briefly and reconnects after restart. During a macro or recording, the install waits until it finishes. Portable builds require manual replacement.</p>'
      + '<div class="desktop-update-actions"><button id="desktop-update-check" class="btn">Check now</button>'
      + '<button id="desktop-update-download" class="btn btn-primary" hidden>Download update</button>'
      + '<button id="desktop-update-install" class="btn btn-primary" hidden>Install and restart</button>'
      + '<button id="desktop-update-cancel-schedule" class="btn btn-secondary" hidden>Cancel scheduled install</button>'
      + '<button id="desktop-update-close" class="btn btn-secondary">Close</button></div>';
    document.body.append(modal);
    const $ = id => document.getElementById(id);
    function render(state) {
      $('desktop-update-version').textContent = 'Installed: ' + state.currentVersion
        + (state.availableVersion ? ' · Available: ' + state.availableVersion : '')
        + (state.portable ? ' · Portable' : '');
      $('desktop-update-message').textContent = state.message;
      $('desktop-update-progress').hidden = state.status !== 'downloading';
      $('desktop-update-progress').value = state.percent || 0;
      $('desktop-update-check').disabled = ['checking', 'downloading', 'downloaded', 'installing'].includes(state.status);
      $('desktop-update-download').hidden = state.status !== 'available';
      $('desktop-update-download').textContent = state.portable ? 'Download portable app' : 'Download update';
      $('desktop-update-install').hidden = state.status !== 'downloaded';
      $('desktop-update-cancel-schedule').hidden = state.status !== 'scheduled';
      button.textContent = state.status === 'available' ? 'Update available'
        : state.status === 'downloading' ? 'Downloading ' + Math.round(state.percent || 0) + '%'
        : state.status === 'downloaded' ? 'Install update'
        : state.status === 'scheduled' ? 'Update scheduled' : 'Updates';
      document.body.inert = state.status === 'installing';
    }
    function open() {
      if (!modal.open) modal.showModal();
      host.getUpdateState().then(render);
    }
    button.addEventListener('click', open);
    $('desktop-update-close').addEventListener('click', () => modal.close());
    $('desktop-update-check').addEventListener('click', () => host.checkForUpdates().then(render));
    $('desktop-update-download').addEventListener('click', () => host.downloadUpdate().then(render));
    $('desktop-update-install').addEventListener('click', () => host.installUpdate().then(render));
    $('desktop-update-cancel-schedule').addEventListener('click', () => host.cancelScheduledUpdate().then(render));
    host.onUpdateState(render);
    host.onShowUpdates(open);
    host.getUpdateState().then(render);
  }

  function notify(text) {
    const toast = document.getElementById('ui-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 6000);
  }

  async function restoreConnectionAfterUpdate() {
    const pending = await host.takePendingReconnect();
    if (!pending) return;
    await new Promise(resolve => setTimeout(resolve, 800));
    notify('Updated. Reconnecting to your device…');
    try {
      const result = await window.AirizConsole.reconnectAfterUpdate(pending);
      notify(result.ok ? 'Reconnected after the update.' : 'Could not reconnect automatically: ' + result.reason + ' Use Connect device.');
    } catch (error) {
      notify('Could not reconnect automatically: ' + error.message + ' Use Connect device.');
    }
  }

  const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const HM10_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
  const HM10_CHARACTERISTIC = '0000ffe1-0000-1000-8000-00805f9b34fb';
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  function framedVersion(text) {
    for (const match of text.matchAll(/#INFO#([\s\S]{0,512}?)#END#/g)) {
      const block = match[1].trim();
      const direct = /^(?:\d+:)?v?(\d+(?:\.\d+){2,3})$/i.exec(block);
      const labeled = /\b(?:firmware|software|version|sw)\b[^\r\n]{0,30}?\b(\d+(?:\.\d+){2,3})\b/i.exec(block);
      if (direct || labeled) return (direct || labeled)[1];
    }
    return null;
  }

  function hexKey(value) {
    return String(value).replace(/[^0-9a-f]/gi, '').toUpperCase().slice(-12);
  }

  // Device picker for "Connect Bluetooth" (AIRIZ-BT remote). Electron has no built-in
  // Web Bluetooth chooser, so remote-ui.js announces the request and this dialog lists
  // what main.cjs reports from 'select-bluetooth-device'.
  // "In use by iPhone (Bluefy) (PIN ok), 3 min" for an AIRIZ-BT whose controller address
  // matches the last "who is connected" list this PC read (Phone remote or a connect).
  function bluetoothUsage(deviceId) {
    const ble = window.AirizBle;
    const info = ble && typeof ble.recallWho === 'function' ? ble.recallWho() : null;
    const hex = value => String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (!info || !info.controller || hex(info.controller) !== hex(deviceId)) return '';
    const checked = Math.max(0, Math.round((Date.now() - info.at) / 60000));
    const when = checked ? ' (checked ' + checked + ' min ago)' : '';
    if (!info.clients.length) return 'Free \u2014 no device connected' + when;
    return 'In use by ' + info.clients.map(ble.describeClient).join('; ') + when;
  }

  function initializeBluetoothPicker() {
    if (!navigator.bluetooth || typeof host.onBluetoothDevices !== 'function') return;
    const dialog = document.createElement('dialog');
    dialog.id = 'bluetooth-picker-dialog';
    dialog.className = 'help-dialog bluetooth-check-dialog';
    dialog.setAttribute('aria-labelledby', 'bluetooth-picker-title');
    dialog.innerHTML = '<h2 id="bluetooth-picker-title">Connect Bluetooth</h2>'
      + '<p>Choose <strong>AIRIZ-BT</strong>. If it is not listed, start it over USB first: '
      + '<strong>Phone remote \u2192 Start remote</strong> (again after every power-up). '
      + 'While a phone is connected the AIRIZ may stop advertising; the Phone remote dialog shows who is connected.</p>'
      + '<p id="bluetooth-picker-status" class="bluetooth-check-result" role="status">Searching\u2026</p>'
      + '<div id="bluetooth-picker-list" class="native-serial-list" role="group" aria-label="Bluetooth devices found"></div>'
      + '<div class="desktop-update-actions"><button id="bluetooth-picker-cancel" class="btn btn-secondary">Cancel</button></div>';
    document.body.append(dialog);
    const list = dialog.querySelector('#bluetooth-picker-list');
    const status = dialog.querySelector('#bluetooth-picker-status');
    let pending = false;
    let cancelWanted = false;

    function close() {
      pending = false;
      if (dialog.open) dialog.close();
    }

    async function cancel() {
      cancelWanted = true;
      // Before the first device report there is no request to cancel yet; the next
      // report is then answered with '' (see below).
      if (await host.chooseBluetoothDevice('')) cancelWanted = false;
      close();
    }

    window.addEventListener('airiz-bluetooth-request', () => {
      pending = true;
      cancelWanted = false;
      list.replaceChildren();
      status.textContent = 'Searching\u2026';
      if (!dialog.open) dialog.showModal();
    });
    window.addEventListener('airiz-bluetooth-request-done', close);

    host.onBluetoothDevices(devices => {
      if (cancelWanted) {
        cancelWanted = false;
        host.chooseBluetoothDevice('');
        return;
      }
      if (!pending) return; // the Bluetooth check handles its own scan
      const sorted = [...devices].sort((first, second) => {
        const firstAiriz = /^AIRIZ/i.test(first.name) ? 0 : 1;
        const secondAiriz = /^AIRIZ/i.test(second.name) ? 0 : 1;
        return firstAiriz - secondAiriz || Number(!first.name) - Number(!second.name);
      });
      status.textContent = sorted.length
        ? 'Found ' + sorted.length + '. Click your AIRIZ-BT.'
        : 'Searching\u2026';
      list.replaceChildren();
      for (const device of sorted) {
        const choice = document.createElement('button');
        choice.className = 'native-serial-port';
        choice.dataset.bluetoothId = device.id;
        const name = document.createElement('strong');
        name.textContent = device.name || 'Unnamed device';
        const details = document.createElement('span');
        details.textContent = device.id;
        choice.append(name, details);
        const usage = bluetoothUsage(device.id);
        if (usage) {
          const note = document.createElement('span');
          note.className = 'bluetooth-in-use';
          note.textContent = usage;
          choice.append(note);
        }
        choice.addEventListener('click', async () => {
          status.textContent = 'Connecting to ' + (device.name || device.id) + '\u2026';
          await host.chooseBluetoothDevice(device.id);
          close();
        });
        list.append(choice);
      }
    });

    dialog.querySelector('#bluetooth-picker-cancel').addEventListener('click', cancel);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      cancel();
    });
  }

  function initializeBluetoothCheck() {
    const anchorButton = document.getElementById('btn-bluetooth-on');
    if (!anchorButton || !navigator.bluetooth) return;
    const button = document.createElement('button');
    button.id = 'btn-bluetooth-check';
    button.className = 'btn btn-secondary';
    button.textContent = 'Bluetooth check';
    button.title = 'Turn on the device radio through the current connection, scan with this PC and verify a Bluetooth command channel.';
    anchorButton.after(button);

    const dialog = document.createElement('dialog');
    dialog.id = 'bluetooth-check-dialog';
    dialog.className = 'help-dialog bluetooth-check-dialog';
    dialog.setAttribute('aria-labelledby', 'bluetooth-check-title');
    dialog.innerHTML = '<h2 id="bluetooth-check-title">Bluetooth check</h2>'
      + '<p>Your USB connection stays open. No motor command is sent.</p>'
      + '<ol class="bluetooth-steps">'
      + '<li id="bt-step-1" data-state="wait"><strong>Turn on device Bluetooth</strong><span>Waiting</span></li>'
      + '<li id="bt-step-2" data-state="wait"><strong>Scan with this PC</strong><span>Waiting</span></li>'
      + '<li id="bt-step-3" data-state="wait"><strong>Verify command channel</strong><span>Waiting</span></li>'
      + '</ol>'
      + '<div id="bluetooth-device-list" class="native-serial-list" role="group" aria-label="Bluetooth devices found"></div>'
      + '<p id="bluetooth-check-result" class="bluetooth-check-result" role="status"></p>'
      + '<div class="desktop-update-actions"><button id="bluetooth-check-export" class="btn" disabled>Export results</button>'
      + '<button id="bluetooth-check-cancel" class="btn btn-secondary">Cancel scan</button>'
      + '<button id="bluetooth-check-close" class="btn btn-secondary">Close</button></div>';
    document.body.append(dialog);
    const $ = id => document.getElementById(id);
    let running = false;
    let scanning = false;
    let controllerKeys = [];
    let report = null;

    function setStep(number, stateName, text) {
      const item = $('bt-step-' + number);
      item.dataset.state = stateName;
      item.querySelector('span').textContent = text;
      report.steps.push({ step: number, state: stateName, detail: text });
    }

    function finish(result, message) {
      report.result = result;
      report.finishedAt = new Date().toISOString();
      $('bluetooth-check-result').textContent = message;
      $('bluetooth-check-result').dataset.result = result;
      $('bluetooth-check-export').disabled = false;
      $('bluetooth-check-cancel').hidden = true;
      running = false;
      scanning = false;
    }

    host.onBluetoothDevices(devices => {
      if (!scanning) return;
      const list = $('bluetooth-device-list');
      list.replaceChildren();
      const sorted = [...devices].sort((first, second) => {
        const firstMatch = controllerKeys.includes(hexKey(first.id)) ? 0 : 1;
        const secondMatch = controllerKeys.includes(hexKey(second.id)) ? 0 : 1;
        return firstMatch - secondMatch || Number(!first.name) - Number(!second.name);
      });
      for (const device of sorted) {
        const choice = document.createElement('button');
        choice.className = 'native-serial-port';
        choice.dataset.bluetoothId = device.id;
        const name = document.createElement('strong');
        const likely = controllerKeys.includes(hexKey(device.id));
        name.textContent = (device.name || 'Unnamed device') + (likely ? '  ★ matches the device controller' : '');
        const details = document.createElement('span');
        details.textContent = device.id;
        choice.append(name, details);
        choice.addEventListener('click', () => host.chooseBluetoothDevice(device.id));
        list.append(choice);
      }
    });

    async function cancelScan() {
      if (scanning) await host.chooseBluetoothDevice('');
    }

    async function runCheck() {
      if (running) return;
      running = true;
      controllerKeys = [];
      report = { app: document.title, startedAt: new Date().toISOString(), steps: [], motorCommandsSent: false };
      for (const number of [1, 2, 3]) {
        $('bt-step-' + number).dataset.state = 'wait';
        $('bt-step-' + number).querySelector('span').textContent = 'Waiting';
      }
      $('bluetooth-device-list').replaceChildren();
      $('bluetooth-check-result').textContent = '';
      $('bluetooth-check-export').disabled = true;
      $('bluetooth-check-cancel').hidden = false;
      if (!dialog.open) dialog.showModal();

      const status = window.AirizConsole.getStatus();
      if (status.macroRunning) {
        setStep(1, 'skip', 'A macro is running, so the radio command was skipped.');
      } else if (status.connected && !status.demoMode) {
        setStep(1, 'run', 'Sending diag ble on through the current connection…');
        const output = document.getElementById('console-output');
        const startLength = output.textContent.length;
        const sent = await window.AirizConsole.sendCommand('diag ble on');
        await sleep(8000);
        const reply = output.textContent.slice(startLength);
        const addresses = [...new Set((reply.match(/(?:[0-9A-F]{2}:){5}[0-9A-F]{2}/gi) || []).map(item => item.toUpperCase()))];
        controllerKeys = addresses.map(hexKey);
        const confirmed = Boolean(sent) && /pegaDiag_BleOn|#INFO#0#END#/.test(reply);
        report.radio = { sent: Boolean(sent), confirmed, controllerAddresses: addresses, reply: reply.slice(-3000) };
        setStep(1, confirmed ? 'pass' : 'warn', confirmed
          ? 'Device reports Bluetooth on' + (addresses.length ? ' · controller ' + addresses.join(', ') : '')
          : 'No confirmation from the device. Continuing with the scan.');
      } else {
        setStep(1, 'skip', status.demoMode ? 'Demo mode: no radio command sent.' : 'Not connected over USB: assuming the device radio is already on.');
      }

      setStep(2, 'run', 'Scanning… choose your AIRIZ device from the list below.');
      scanning = true;
      let device;
      try {
        device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [NUS_SERVICE, HM10_SERVICE] });
      } catch (error) {
        scanning = false;
        setStep(2, 'fail', error.name === 'NotFoundError' ? 'No device selected.' : error.message);
        finish('not-selected', 'No Bluetooth device was selected. If AIRIZ never appears, its radio is not advertising Bluetooth LE.');
        return;
      }
      scanning = false;
      $('bluetooth-device-list').replaceChildren();
      report.device = { id: device.id, name: device.name || null, matchesController: controllerKeys.includes(hexKey(device.id)) };
      setStep(2, 'pass', 'Selected ' + (device.name || device.id));

      setStep(3, 'run', 'Connecting and looking for a command service…');
      try {
        const server = await device.gatt.connect();
        let profile = null;
        for (const [name, service, writeId, notifyId] of [
          ['Nordic UART', NUS_SERVICE, NUS_WRITE, NUS_NOTIFY],
          ['HM-10 UART', HM10_SERVICE, HM10_CHARACTERISTIC, HM10_CHARACTERISTIC]
        ]) {
          try {
            profile = { name, service: await server.getPrimaryService(service), writeId, notifyId };
            break;
          } catch {
            // Try the next known command profile.
          }
        }
        if (!profile) {
          device.gatt.disconnect();
          setStep(3, 'fail', 'Connected, but no Bluetooth command service was found.');
          finish('no-command-service', 'Bluetooth connects, but the device firmware exposes no command service. Phone motor control needs a firmware Bluetooth command (UART) service.');
          return;
        }
        const writer = await profile.service.getCharacteristic(profile.writeId);
        const notifier = await profile.service.getCharacteristic(profile.notifyId);
        let reply = '';
        notifier.addEventListener('characteristicvaluechanged', event => {
          reply += new TextDecoder().decode(event.target.value);
        });
        await notifier.startNotifications();
        const bytes = new TextEncoder().encode('diag ver sw\r\n');
        for (let offset = 0; offset < bytes.length; offset += 20) {
          const part = bytes.slice(offset, offset + 20);
          if (writer.properties.write) await writer.writeValueWithResponse(part);
          else await writer.writeValueWithoutResponse(part);
        }
        await sleep(4000);
        device.gatt.disconnect();
        const version = framedVersion(reply);
        report.commandChannel = { profile: profile.name, reply: reply.slice(-2000), verifiedVersion: version };
        if (version) {
          setStep(3, 'pass', profile.name + ' answered with firmware ' + version);
          finish('verified', 'Bluetooth command channel verified. The phone app can control this device.');
        } else {
          setStep(3, 'fail', profile.name + ' found, but there was no valid firmware reply.');
          finish('unverified-channel', 'A Bluetooth serial service exists but did not answer like the AIRIZ console. Export the results for diagnosis.');
        }
      } catch (error) {
        try { device.gatt.disconnect(); } catch { /* already disconnected */ }
        setStep(3, 'fail', error.message);
        finish('connection-failed', 'Could not connect to the selected device: ' + error.message);
      }
    }

    button.addEventListener('click', runCheck);
    $('bluetooth-check-cancel').addEventListener('click', cancelScan);
    $('bluetooth-check-close').addEventListener('click', async () => {
      await cancelScan();
      dialog.close();
    });
    dialog.addEventListener('cancel', async event => {
      event.preventDefault();
      await cancelScan();
      dialog.close();
    });
    $('bluetooth-check-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'airiz-bluetooth-check.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeDesktop);
  else initializeDesktop();
})();
