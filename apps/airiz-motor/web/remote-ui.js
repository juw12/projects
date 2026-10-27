/* AIRIZ remote controls: Stop motor, Connect Bluetooth (Web Bluetooth / Bluefy on
 * iPhone) and the Phone remote setup dialog that installs and starts the device's
 * Bluetooth bridge over the USB console and shows its PIN.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const ble = window.AirizBle;
  if (!api || !ble) return;
  const $ = id => document.getElementById(id);
  const toast = text => {
    const notice = $('ui-toast');
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { notice.hidden = true; }, 9000);
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const native = !!(window.airizMobile || window.airizDesktop);
  let remoteBusy = false;
  let lastRemotePin = null; // PIN of the remote this PC just started (fills the PIN step)

  // ------------------------------------------------------------ Stop motor
  const stopButton = $('btn-stop-motor');
  if (stopButton) {
    stopButton.addEventListener('click', async () => {
      const sent = await api.stopMotor();
      toast(sent ? 'Stop sent. The motor driver halts the current move.' : 'Not connected.');
    });
  }

  // ------------------------------------------------------------ Connect Bluetooth (website only)
  const bleButton = $('btn-connect-ble');
  let bleConnecting = false;

  async function connectBluetooth(options = {}) {
    if (api.getStatus().connected || bleConnecting) return;
    if (!navigator.bluetooth) {
      toast(ble.webBluetoothHelp());
      return;
    }
    bleConnecting = true;
    if (bleButton) bleButton.disabled = true;
    // The desktop app shows its own device picker (desktop-integration.js).
    window.dispatchEvent(new CustomEvent('airiz-bluetooth-request'));
    try {
      toast('Choose AIRIZ-BT. No motor command is sent while connecting.');
      const port = await ble.requestWebBluetoothPort(lost => {
        window.dispatchEvent(new CustomEvent('airiz-port-lost', { detail: lost }));
      }, { pinHint: lastRemotePin });
      await api.connectPort(port);
      const others = port.otherClients || [];
      const alsoConnected = others.length
        ? ' Also connected to this AIRIZ: ' + others.map(ble.describeClient).join('; ') + '.'
        : '';
      toast((port.bridge ? 'Bluetooth remote unlocked. Motor controls are ready.' : 'Bluetooth connected.') + alsoConnected);
    } catch (error) {
      if (error && (error.name === 'NotFoundError' || error.name === 'AbortError')) return;
      if (options.auto && error && error.name === 'SecurityError') {
        // Browser wants a tap before showing the Bluetooth chooser.
        toast('Tap "Connect AIRIZ" to choose AIRIZ-BT.');
        if (iphoneButton) iphoneButton.focus();
        return;
      }
      const detail = error && (error.message || error.name) ? (error.message || error.name) : String(error);
      toast('Bluetooth connection failed: ' + detail);
    } finally {
      bleConnecting = false;
      window.dispatchEvent(new CustomEvent('airiz-bluetooth-request-done'));
      refresh();
    }
  }

  // Website and Windows app (the Android app has its own native Bluetooth connect).
  if (bleButton && !window.airizMobile && (!window.airizDesktop || navigator.bluetooth)) {
    bleButton.hidden = false;
    bleButton.addEventListener('click', () => connectBluetooth());
  }

  // ------------------------------------------------------------ iPhone button (Bluefy)
  // Inside Bluefy the button connects directly. Everywhere else it is a plain link to
  // iphone.html, which opens this console in Bluefy (App Store only if not installed).
  const iphoneButton = $('iphone-bluefy');
  const CONNECT_PARAM = 'ble';
  const inBluefy = () => /Bluefy/i.test(navigator.userAgent) || (!!navigator.bluetooth && ble.isIos());

  if (iphoneButton && !native) {
    if (inBluefy()) {
      iphoneButton.textContent = 'Connect AIRIZ';
      iphoneButton.title = 'Connect to the AIRIZ Bluetooth remote (AIRIZ-BT) and enter its PIN.';
    }
    iphoneButton.addEventListener('click', event => {
      if (!inBluefy()) return; // follow the link to iphone.html
      event.preventDefault();
      connectBluetooth();
    });
  }

  // Opened from Safari via bluefy://open?url=…?ble=connect → start connecting.
  const params = new URLSearchParams(location.search);
  if (!native && params.get(CONNECT_PARAM) === 'connect') {
    params.delete(CONNECT_PARAM);
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    if (navigator.bluetooth) {
      setTimeout(() => connectBluetooth({ auto: true }), 600);
    }
  }

  // ------------------------------------------------------------ Phone remote (USB)
  const remoteButton = $('btn-phone-remote');
  let dialog = null;

  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.id = 'phone-remote-dialog';
    dialog.className = 'help-dialog phone-remote-dialog';
    dialog.setAttribute('aria-labelledby', 'phone-remote-title');
    dialog.innerHTML = '<h2 id="phone-remote-title">Phone remote (Bluetooth)</h2>'
      + '<p>Installs the AIRIZ Bluetooth remote on the device (kept in <code>/data/airiz</code>) and starts it. '
      + 'Start it again after every power-up — the device firmware cannot auto-start it.</p>'
      + '<div id="phone-remote-pin" class="phone-remote-pin" hidden><span>PIN</span><strong id="phone-remote-pin-value"></strong></div>'
      + '<p id="phone-remote-status" class="phone-remote-status" role="status"></p>'
      + '<section class="phone-remote-clients" aria-labelledby="phone-remote-clients-title">'
      + '<h3 id="phone-remote-clients-title">Connected by Bluetooth</h3>'
      + '<ul id="phone-remote-clients" aria-live="polite"><li class="muted">Start the remote to see connected devices.</li></ul>'
      + '</section>'
      + '<ol class="phone-remote-steps"><li>iPhone: install the free <strong>Bluefy</strong> browser, open '
      + '<code>juw12.github.io/projects/airiz-motor</code>, tap <strong>Connect Bluetooth</strong>, choose <strong>AIRIZ-BT</strong> and enter the PIN.</li>'
      + '<li>Android: the AIRIZ Mobile app or Chrome on this website.</li></ol>'
      + '<div class="desktop-update-actions">'
      + '<button id="phone-remote-start" class="btn btn-primary">Start remote</button>'
      + '<button id="phone-remote-newpin" class="btn">New PIN</button>'
      + '<button id="phone-remote-stop" class="btn">Stop remote</button>'
      + '<button id="phone-remote-pc-ble" class="btn btn-primary" hidden>Connect this PC by Bluetooth</button>'
      + '<button id="phone-remote-close" class="btn btn-secondary">Close</button></div>';
    document.body.append(dialog);
    $('phone-remote-start').addEventListener('click', () => startRemote(false));
    $('phone-remote-newpin').addEventListener('click', () => startRemote(true));
    $('phone-remote-stop').addEventListener('click', stopRemote);
    $('phone-remote-pc-ble').addEventListener('click', switchPcToBluetooth);
    $('phone-remote-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => {
      if (remoteBusy) event.preventDefault();
    });
    dialog.addEventListener('close', stopClientPolling);
  }

  // ---- who is connected to the AIRIZ over Bluetooth (bridge v3, read over USB)
  let clientTimer = null;
  let clientPolling = false;

  function renderClients(info, note) {
    const list = $('phone-remote-clients');
    if (!list) return;
    const rows = info && info.clients.length ? info.clients.map(client => {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = client.label || 'Unnamed device';
      const details = document.createElement('span');
      const minutes = Math.round(client.seconds / 60);
      const age = client.seconds < 60 ? 'just connected' : minutes < 60 ? minutes + ' min'
        : Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
      details.textContent = ' \u00b7 ' + (client.pinOk ? 'PIN ok' : 'no PIN yet') + ' \u00b7 ' + age
        + ' \u00b7 ' + client.address;
      item.append(name, details);
      return item;
    }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: note || 'No device connected by Bluetooth.' })];
    list.replaceChildren(...rows);
  }

  async function pollClients() {
    if (clientPolling || remoteBusy || !dialog || !dialog.open) return;
    const status = api.getStatus();
    if (!status.connected || /^(Bluetooth|Remote)/.test(String(status.transportLabel || ''))) return;
    clientPolling = true;
    api.setOutputMuted(true);
    try {
      // The echoed command line contains "$(date" literally, so only the real output matches.
      const reply = await run('echo "#AIRIZBT#who#$(date +%s)#$(cat /tmp/airiz/self 2>/dev/null)#"; '
        + 'cat /tmp/airiz/clients 2>/dev/null; echo "#AIRIZBT#""whoend#END#"',
      text => /#AIRIZBT#whoend#END#/.test(text), 4000);
      const head = /#AIRIZBT#who#(\d+)#([0-9A-Fa-f:]*)#/.exec(reply);
      if (!head) return;
      const now = Number(head[1]);
      const body = reply.slice(head.index).split('#AIRIZBT#whoend#END#')[0];
      const clients = [];
      for (const match of body.matchAll(/^([0-9A-Fa-f:]{17})\|([^|\r\n]*)\|(\d+)\|([01])\s*$/gm)) {
        clients.push({
          address: match[1].toUpperCase(),
          label: match[2] === '-' ? '' : match[2],
          seconds: Math.max(0, now - Number(match[3])),
          pinOk: match[4] === '1',
        });
      }
      const info = { controller: head[2].toUpperCase(), clients };
      if (info.controller) ble.rememberWho(info);
      renderClients(info, head[2] ? '' : 'The Bluetooth remote is not running (or is an older version). Press Start remote.');
    } catch (ignored) {
      /* USB busy or disconnected; try again next time */
    } finally {
      api.setOutputMuted(false);
      clientPolling = false;
    }
  }

  function startClientPolling() {
    stopClientPolling();
    pollClients();
    clientTimer = setInterval(pollClients, 4000);
  }

  function stopClientPolling() {
    clearInterval(clientTimer);
    clientTimer = null;
  }

  function setStatus(text) {
    $('phone-remote-status').textContent = text;
  }

  function setBusy(value) {
    remoteBusy = value;
    for (const id of ['phone-remote-start', 'phone-remote-newpin', 'phone-remote-stop', 'phone-remote-close']) {
      $(id).disabled = value;
    }
  }

  // Collect device output while running one shell command.
  async function run(command, done, timeoutMs) {
    let output = '';
    const stop = api.onOutput(text => { output += text; });
    try {
      const sent = await api.sendCommand(command, { quiet: true });
      if (!sent) throw new Error('The USB connection is not ready.');
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (done(output)) return output;
        await sleep(40);
      }
      return output;
    } finally {
      stop();
    }
  }

  const prompt = text => /#\s*$/.test(text.replace(/\s+$/, ' '));

  async function installFiles() {
    const files = window.AIRIZ_BRIDGE_FILES || [];
    if (!files.length) throw new Error('Bridge files are missing from this build.');
    await run('mkdir -p /data/airiz /tmp/airiz', prompt, 3000);
    const sums = await run('md5sum ' + files.map(file => '/data/airiz/' + file.name).join(' ')
      + ' 2>/dev/null; echo "#AIRIZBT#""md5#END#"', text => /#AIRIZBT#md5#END#/.test(text), 5000);
    let changed = 0;
    for (const file of files) {
      if (sums.includes(file.md5 + '  /data/airiz/' + file.name)) continue;
      changed++;
      setStatus('Installing ' + file.name + '…');
      await run('rm -f /tmp/airiz/u.b64', prompt, 2000);
      for (let offset = 0; offset < file.base64.length; offset += 512) {
        await run('echo ' + file.base64.slice(offset, offset + 512) + ' >> /tmp/airiz/u.b64', prompt, 3000);
      }
      const check = await run('base64 -d /tmp/airiz/u.b64 > /data/airiz/' + file.name + '.new && mv /data/airiz/' + file.name
        + '.new /data/airiz/' + file.name + ' && sync && md5sum /data/airiz/' + file.name + '; echo "#AIRIZBT#""up#END#"',
      text => /#AIRIZBT#up#END#/.test(text), 8000);
      if (!check.includes(file.md5)) throw new Error('Upload check failed for ' + file.name + '. Try again.');
    }
    return changed;
  }

  async function startRemote(newPin) {
    if (remoteBusy) return;
    setBusy(true);
    while (clientPolling) await sleep(50);
    $('phone-remote-pin').hidden = true;
    api.setOutputMuted(true);
    try {
      setStatus('Checking the files on the device…');
      const changed = await installFiles();
      setStatus((changed ? 'Installed. ' : '') + 'Starting Bluetooth (about 10 s)…');
      const reply = await run('sh /data/airiz/start.sh 0' + (newPin ? ' newpin' : ''),
        text => /#AIRIZBT#(ready#PIN=\d{6}|failed[^#]*)#END#/.test(text), 60000);
      const match = /#AIRIZBT#ready#PIN=(\d{6})#END#/.exec(reply);
      if (!match) throw new Error('The Bluetooth remote did not start. See /tmp/airiz/out on the device.');
      $('phone-remote-pin-value').textContent = match[1];
      $('phone-remote-pin').hidden = false;
      lastRemotePin = match[1];
      $('phone-remote-pc-ble').hidden = !navigator.bluetooth || !!window.airizMobile;
      setStatus('AIRIZ-BT is advertising until the device is switched off. Connect a phone, '
        + 'or press "Connect this PC by Bluetooth" to control it wirelessly from here. You can unplug USB now.');
      startClientPolling();
    } catch (error) {
      setStatus(error.message || 'Setup failed.');
    } finally {
      api.setOutputMuted(false);
      setBusy(false);
    }
  }

  // Close the USB session and reconnect this PC to the device over Bluetooth (AIRIZ-BT).
  async function switchPcToBluetooth() {
    if (remoteBusy || bleConnecting) return;
    if (api.getStatus().connected) {
      const disconnectButton = $('btn-disconnect');
      if (disconnectButton && !disconnectButton.disabled) disconnectButton.click();
      for (let waited = 0; api.getStatus().connected && waited < 3000; waited += 100) await sleep(100);
      if (api.getStatus().connected) {
        setStatus('Disconnect USB first, then press Connect Bluetooth.');
        return;
      }
    }
    dialog.close();
    await connectBluetooth();
  }

  async function stopRemote() {
    if (remoteBusy) return;
    setBusy(true);
    while (clientPolling) await sleep(50);
    try {
      const reply = await run('sh /data/airiz/stop.sh', text => /#AIRIZBT#stopped#END#/.test(text) || /not found/.test(text), 8000);
      $('phone-remote-pin').hidden = true;
      $('phone-remote-pc-ble').hidden = true;
      lastRemotePin = null;
      stopClientPolling();
      renderClients(null, 'The Bluetooth remote is stopped.');
      setStatus(/#AIRIZBT#stopped#END#/.test(reply) ? 'Bluetooth remote stopped.' : 'The remote is not installed on this device.');
    } finally {
      setBusy(false);
    }
  }

  if (remoteButton) {
    if (window.airizMobile) remoteButton.hidden = true;
    remoteButton.addEventListener('click', () => {
      if (!dialog) buildDialog();
      setStatus('Connected over USB. Press Start remote.');
      $('phone-remote-pin').hidden = true;
      renderClients(null, 'Checking\u2026');
      dialog.showModal();
      startClientPolling(); // shows phones already connected to a running remote
    });
  }

  // ------------------------------------------------------------ availability
  function refresh() {
    const status = api.getStatus();
    const usb = status.connected && !status.demoMode && !/^(Bluetooth|Remote)/.test(String(status.transportLabel || ''));
    if (stopButton) stopButton.disabled = !status.connected;
    if (bleButton) bleButton.disabled = status.connected;
    if (remoteButton) remoteButton.disabled = !usb || status.macroRunning || remoteBusy;
  }
  setInterval(refresh, 500);
  refresh();
}());
