/* AIRIZ remote control by code (no Bluetooth needed).
 *
 * Works like the phone camera viewer, but for the whole console:
 *   PC   (connected to the AIRIZ by USB): "Share control" -> shows a 6-digit code and a link.
 *   Phone / other PC (any browser, the Windows app or the Android app):
 *        "Connect by code" -> enter the code -> the PC operator presses Allow ->
 *        the full console (motor, LEDs, command library, macros, sound, audio, log)
 *        controls the AIRIZ through the PC.
 *
 * Transport: PeerJS data channel (peer-to-peer WebRTC; the free PeerJS server only
 * introduces the peers) and, in parallel, the AIRIZ relay worker over HTTPS WebSocket
 * for networks that block WebRTC (company Wi-Fi). Whichever path the PC approves first
 * is used.
 *
 * On the phone the connection is a normal console "port": AirizBle.VerifiedSerialPort
 * wraps a byte link, so motor controls stay locked until the device answers the
 * firmware-version query, exactly like USB and Bluetooth.
 *
 * Safety: the PC operator must allow every controller; one controller at a time; the PC
 * can revoke at any time; if a controller drops shortly after a motor command, the PC
 * sends a motor stop. Lines are length- and rate-limited.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const ble = window.AirizBle;
  if (!api || !ble) return;

  const PeerLib = window.Peer;
  const RELAY_ORIGIN = (window.AirizFrameRelay && window.AirizFrameRelay.RELAY_ORIGIN)
    || 'wss://airiz-relay.juw12.workers.dev';
  const PEER_PREFIX = 'airiz-ctl-';
  const PUBLIC_CONSOLE_URL = 'https://juw12.github.io/projects/airiz-motor/';
  const PROTOCOL_VERSION = 1;
  const MAX_LINE = 1000;
  const MAX_LINES_PER_SECOND = 25;
  const RX_CHUNK = 12000;
  const MOTOR_STOP_WINDOW_MS = 120000;
  const FIND_PC_TIMEOUT_MS = 20000;
  const APPROVAL_TIMEOUT_MS = 120000;
  const VERIFY_TIMEOUT_MS = 20000;

  const $ = id => document.getElementById(id);
  const encoder = new TextEncoder();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deviceLabel = () => (typeof window.AirizDeviceLabel === 'function' ? window.AirizDeviceLabel() : '') || 'Browser';
  const cleanLabel = value => String(value || '').replace(/[^A-Za-z0-9 ._()-]/g, '').slice(0, 40);
  const cleanId = value => String(value || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  const isRemoteTransport = status => String(status.transportLabel || '').startsWith('Remote');

  function toast(text) {
    const notice = $('ui-toast');
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { notice.hidden = true; }, 9000);
  }

  function randomDigits() {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return String(value[0] % 1000000).padStart(6, '0');
  }

  function randomId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function ageText(since) {
    const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
  }

  function controlLink(code) {
    const base = /^https?:$/.test(location.protocol) ? new URL('index.html', location.href).href : PUBLIC_CONSOLE_URL;
    return base + '#control=' + code;
  }

  // =================================================================== PC: share control
  const host = {
    code: null,
    peer: null,
    relay: null,
    relayRetry: null,
    stopOutput: null,
    controllers: new Map(), // cid -> controller
    pathOwner: new Map(),   // path key -> cid
    dialog: null,
    watchTimer: null,
  };

  function hostBuildDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'share-control-dialog';
    dialog.className = 'help-dialog phone-remote-dialog';
    dialog.setAttribute('aria-labelledby', 'share-control-title');
    dialog.innerHTML = '<h2 id="share-control-title">Remote control by code</h2>'
      + '<p>Let a phone or another PC control this AIRIZ through this PC - no Bluetooth needed. '
      + 'On the other device open the AIRIZ console, press <strong>Connect by code</strong> and enter the code. '
      + 'You decide who may control it.</p>'
      + '<div id="share-control-code-box" class="phone-remote-pin" hidden><span>CODE</span><strong id="share-control-code"></strong></div>'
      + '<div id="share-control-link-row" class="share-control-link-row" hidden>'
      + '<input id="share-control-link" class="input" readonly aria-label="Remote control link">'
      + '<button id="share-control-copy" class="btn">Copy link</button></div>'
      + '<p id="share-control-status" class="phone-remote-status" role="status"></p>'
      + '<section class="phone-remote-clients" aria-labelledby="share-control-list-title">'
      + '<h3 id="share-control-list-title">Controllers</h3>'
      + '<ul id="share-control-list" aria-live="polite"><li class="muted">Nobody yet.</li></ul></section>'
      + '<p class="help-warning">The allowed device can move the motors and send any console command. '
      + 'Stop motor and Esc on this PC always work; a move already sent finishes unless stopped.</p>'
      + '<div class="desktop-update-actions">'
      + '<button id="share-control-start" class="btn btn-primary">Start sharing</button>'
      + '<button id="share-control-stop" class="btn" disabled>Stop sharing</button>'
      + '<button id="share-control-close" class="btn btn-secondary">Close</button></div>';
    document.body.append(dialog);
    $('share-control-start').addEventListener('click', () => hostStart());
    $('share-control-stop').addEventListener('click', () => hostStop('Sharing stopped.'));
    $('share-control-close').addEventListener('click', () => dialog.close());
    $('share-control-copy').addEventListener('click', hostCopyLink);
    host.dialog = dialog;
    return dialog;
  }

  function hostSetStatus(text) {
    const status = $('share-control-status');
    if (status) status.textContent = text;
  }

  async function hostCopyLink() {
    const input = $('share-control-link');
    if (!input || !input.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (error) {
      input.select();
      document.execCommand('copy');
    }
    hostSetStatus('Link copied. The other device still needs your Allow before it can control the AIRIZ.');
  }

  function approvedController() {
    for (const controller of host.controllers.values()) {
      if (controller.state === 'approved') return controller;
    }
    return null;
  }

  function hostRender() {
    const list = $('share-control-list');
    const button = $('btn-share-control');
    const approved = approvedController();
    const pending = [...host.controllers.values()].filter(item => item.state === 'pending').length;
    if (button) {
      const label = button.querySelector('span') || button;
      label.textContent = host.code
        ? (approved ? 'Shared · ' + approved.label : pending ? 'Share control · ' + pending + ' waiting' : 'Sharing control')
        : 'Share control';
      button.classList.toggle('btn-primary', !!host.code);
      button.classList.toggle('btn-secondary', !host.code);
    }
    if (!list) return;
    const rows = [...host.controllers.values()].map(controller => {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = controller.label;
      const paths = [...controller.paths.keys()].map(key => (key.startsWith('p:') ? 'direct' : 'via AIRIZ relay'));
      const details = document.createElement('span');
      details.textContent = ' \u00b7 ' + (controller.state === 'approved' ? 'controlling' : 'asks to control')
        + ' \u00b7 ' + [...new Set(paths)].join(' + ') + ' \u00b7 ' + ageText(controller.since) + ' ';
      item.append(name, details);
      if (controller.state === 'pending') {
        const allow = document.createElement('button');
        allow.className = 'btn btn-primary';
        allow.textContent = 'Allow';
        allow.disabled = !!approved;
        allow.title = approved ? 'Only one device can control at a time. Disconnect the current one first.' : '';
        allow.addEventListener('click', () => hostApprove(controller.cid));
        const deny = document.createElement('button');
        deny.className = 'btn';
        deny.textContent = 'Deny';
        deny.addEventListener('click', () => hostDeny(controller.cid, 'denied'));
        item.append(allow, document.createTextNode(' '), deny);
      } else {
        const revoke = document.createElement('button');
        revoke.className = 'btn btn-danger';
        revoke.textContent = 'Disconnect';
        revoke.addEventListener('click', () => hostDeny(controller.cid, 'revoked'));
        item.append(revoke);
      }
      return item;
    });
    list.replaceChildren(...(rows.length ? rows
      : [Object.assign(document.createElement('li'), { className: 'muted', textContent: host.code ? 'Waiting for a device to connect…' : 'Nobody yet.' })]));
  }

  function hostSend(controller, message) {
    for (const send of controller.paths.values()) {
      try {
        send(message);
      } catch (ignored) { /* path closing */ }
    }
  }

  function hostForwardOutput(text) {
    const controller = approvedController();
    if (!controller || !text) return;
    for (let offset = 0; offset < text.length; offset += RX_CHUNK) {
      hostSend(controller, { type: 'rx', data: text.slice(offset, offset + RX_CHUNK) });
    }
  }

  function hostApprove(cid) {
    const controller = host.controllers.get(cid);
    if (!controller || controller.state !== 'pending') return;
    if (approvedController()) {
      hostSetStatus('Only one device can control at a time. Disconnect the current one first.');
      return;
    }
    controller.state = 'approved';
    controller.since = Date.now();
    hostSend(controller, { type: 'state', state: 'approved' });
    toast(controller.label + ' is now controlling the AIRIZ through this PC.');
    hostSetStatus(controller.label + ' is controlling the AIRIZ. Commands it sends appear in the Live console.');
    hostRender();
  }

  function hostDeny(cid, reason) {
    const controller = host.controllers.get(cid);
    if (!controller) return;
    hostSend(controller, { type: 'state', state: reason });
    hostDropController(cid, reason === 'revoked' ? 'Disconnected ' + controller.label + '.' : 'Denied ' + controller.label + '.');
  }

  async function hostDropController(cid, note) {
    const controller = host.controllers.get(cid);
    if (!controller) return;
    host.controllers.delete(cid);
    for (const [key, closer] of controller.closers) {
      host.pathOwner.delete(key);
      try {
        closer();
      } catch (ignored) { /* already closed */ }
    }
    for (const key of controller.paths.keys()) host.pathOwner.delete(key);
    if (controller.state === 'approved' && Date.now() - controller.lastMotorAt < MOTOR_STOP_WINDOW_MS) {
      const sent = await api.stopMotor();
      toast((note || controller.label + ' left.') + (sent ? ' Motor stop sent for safety.' : ''));
    } else if (note) {
      toast(note);
    }
    if (note) hostSetStatus(note);
    hostRender();
  }

  // A transport path (one PeerJS connection or one relay controller id) said something.
  function hostReceive(pathKey, send, closer, message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello') {
      const cid = cleanId(message.cid) || pathKey;
      let controller = host.controllers.get(cid);
      if (!controller) {
        controller = {
          cid,
          label: cleanLabel(message.label) || 'Remote device',
          state: 'pending',
          since: Date.now(),
          paths: new Map(),
          closers: new Map(),
          lastMotorAt: 0,
          buffer: '',
          lineTimes: [],
          queue: Promise.resolve(),
        };
        host.controllers.set(cid, controller);
        const busy = approvedController();
        toast(busy
          ? controller.label + ' asks to control the AIRIZ (waiting: ' + busy.label + ' is controlling).'
          : controller.label + ' asks to control the AIRIZ. Allow it in Share control.');
        if (host.dialog && !host.dialog.open) host.dialog.showModal();
      }
      controller.paths.set(pathKey, send);
      if (closer) controller.closers.set(pathKey, closer);
      host.pathOwner.set(pathKey, cid);
      send({ type: 'state', state: controller.state === 'approved' ? 'approved' : 'pending', pc: deviceLabel() });
      hostRender();
      return;
    }
    const cid = host.pathOwner.get(pathKey);
    const controller = cid && host.controllers.get(cid);
    if (!controller) return;
    if (message.type === 'bye') {
      hostDropController(cid, controller.label + ' disconnected.');
      return;
    }
    if (message.type === 'tx' && controller.state === 'approved' && typeof message.data === 'string') {
      hostAcceptText(controller, message.data);
    }
  }

  function hostAcceptText(controller, text) {
    controller.buffer += text.replace(/\r/g, '');
    if (controller.buffer.length > MAX_LINE * 4) controller.buffer = controller.buffer.slice(-MAX_LINE * 4);
    let newline = controller.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = controller.buffer.slice(0, newline);
      controller.buffer = controller.buffer.slice(newline + 1);
      hostQueueLine(controller, line);
      newline = controller.buffer.indexOf('\n');
    }
  }

  function hostQueueLine(controller, line) {
    const now = Date.now();
    controller.lineTimes = controller.lineTimes.filter(time => now - time < 1000);
    if (controller.lineTimes.length >= MAX_LINES_PER_SECOND) {
      hostSend(controller, { type: 'rx', data: '\r\n[PC] Too many commands per second - command skipped.\r\n' });
      return;
    }
    if (line.length > MAX_LINE) {
      hostSend(controller, { type: 'rx', data: '\r\n[PC] Command too long - skipped.\r\n' });
      return;
    }
    controller.lineTimes.push(now);
    if (/\bdiag\s+motor\b/i.test(line)) controller.lastMotorAt = now;
    controller.queue = controller.queue.then(async () => {
      if (!host.controllers.has(controller.cid) || controller.state !== 'approved') return;
      // The phone sends the USB stop command; let this PC use its own stop for its transport.
      if (line.trim() === ble.MOTOR_STOP_USB) {
        await api.stopMotor();
        return;
      }
      let sent = await api.sendCommand(line);
      if (!sent) {
        await sleep(150);
        sent = await api.sendCommand(line);
      }
      if (!sent) hostSend(controller, { type: 'rx', data: '\r\n[PC] The PC could not send this command (busy or disconnected).\r\n' });
    }).catch(() => {});
  }

  function hostPathClosed(pathKey) {
    const cid = host.pathOwner.get(pathKey);
    host.pathOwner.delete(pathKey);
    const controller = cid && host.controllers.get(cid);
    if (!controller) return;
    controller.paths.delete(pathKey);
    controller.closers.delete(pathKey);
    if (controller.paths.size === 0) hostDropController(cid, controller.label + ' disconnected.');
    else hostRender();
  }

  function hostStartPeer(code, attempt) {
    if (!PeerLib) return;
    const peer = new PeerLib(PEER_PREFIX + code, { debug: 0 });
    host.peer = peer;
    peer.on('connection', connection => {
      const key = 'p:' + connection.peer;
      const send = message => {
        if (connection.open) connection.send(message);
      };
      connection.on('data', message => hostReceive(key, send, () => connection.close(), message));
      connection.on('close', () => hostPathClosed(key));
      connection.on('error', () => hostPathClosed(key));
    });
    peer.on('error', error => {
      if (host.peer !== peer) return;
      if (error.type === 'unavailable-id' && attempt < 3) {
        // Code already taken on the PeerJS server: start over with a new code.
        hostStop(null, true);
        hostStart(attempt + 1);
      }
      // Other PeerJS errors: the AIRIZ relay keeps serving controllers.
    });
    peer.on('disconnected', () => {
      if (host.peer === peer && !peer.destroyed) peer.reconnect();
    });
  }

  function hostStartRelay(code) {
    if (host.code !== code) return;
    let socket;
    try {
      socket = new WebSocket(RELAY_ORIGIN + '/v1/control/' + code + '?role=pc');
    } catch (error) {
      return;
    }
    host.relay = socket;
    const relayKeys = new Set();
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (ignored) {
        return;
      }
      const from = cleanId(message.from);
      if (!from) return;
      const key = 'r:' + from;
      if (message.type === 'left') {
        relayKeys.delete(key);
        hostPathClosed(key);
        return;
      }
      relayKeys.add(key);
      const send = reply => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(Object.assign({}, reply, { to: from })));
      };
      hostReceive(key, send, null, message);
    });
    socket.addEventListener('close', () => {
      for (const key of relayKeys) hostPathClosed(key);
      relayKeys.clear();
      if (host.relay === socket) host.relay = null;
      if (host.code === code) host.relayRetry = setTimeout(() => hostStartRelay(code), 3000);
    });
  }

  function hostStart(attempt = 0) {
    const status = api.getStatus();
    if (!status.connected) {
      hostSetStatus('Connect the AIRIZ to this PC first (USB, or Try demo to test).');
      return;
    }
    if (isRemoteTransport(status)) {
      hostSetStatus('This console is itself remote-controlled. Share control from the PC that has the USB cable.');
      return;
    }
    if (host.code) return;
    const code = randomDigits();
    host.code = code;
    hostStartPeer(code, attempt);
    hostStartRelay(code);
    host.stopOutput = api.onOutput(hostForwardOutput);
    $('share-control-code').textContent = code;
    $('share-control-code-box').hidden = false;
    $('share-control-link').value = controlLink(code);
    $('share-control-link-row').hidden = false;
    $('share-control-start').disabled = true;
    $('share-control-stop').disabled = false;
    hostSetStatus('On the phone or other PC: open the AIRIZ console, press Connect by code and enter '
      + code + ' (or open the link). Keep this window open while sharing.');
    clearInterval(host.watchTimer);
    host.watchTimer = setInterval(() => {
      if (host.code && !api.getStatus().connected) hostStop('Sharing stopped because the AIRIZ was disconnected from this PC.');
    }, 2000);
    hostRender();
  }

  function hostStop(note, quiet) {
    for (const controller of host.controllers.values()) {
      hostSend(controller, { type: 'ended' });
    }
    const drops = [...host.controllers.keys()].map(cid => hostDropController(cid, null));
    Promise.all(drops).catch(() => {});
    host.code = null;
    clearInterval(host.watchTimer);
    clearTimeout(host.relayRetry);
    if (host.stopOutput) host.stopOutput();
    host.stopOutput = null;
    if (host.peer) host.peer.destroy();
    host.peer = null;
    if (host.relay) {
      const socket = host.relay;
      host.relay = null;
      try {
        socket.close();
      } catch (ignored) { /* closing */ }
    }
    if ($('share-control-code-box')) {
      $('share-control-code-box').hidden = true;
      $('share-control-link-row').hidden = true;
      $('share-control-link').value = '';
      $('share-control-start').disabled = false;
      $('share-control-stop').disabled = true;
    }
    if (!quiet && note) {
      hostSetStatus(note);
      toast(note);
    }
    hostRender();
  }

  // =================================================================== phone: connect by code
  // A byte "link" for AirizBle.VerifiedSerialPort that tunnels the console through the PC.
  function createCodeLink(code, report) {
    const cid = randomId();
    const decoder = new TextDecoder();
    const paths = [];
    let active = null;
    let closed = false;
    let pcSeen = false;
    let onData = null;
    let onLost = null;
    let settle = null;

    const label = 'Remote control (code ' + code + ')';

    function finish(error) {
      if (!settle) return;
      const done = settle;
      settle = null;
      done(error);
    }

    function lost(error) {
      if (closed) return;
      if (settle) {
        finish(error);
        return;
      }
      if (onLost) onLost(error);
    }

    function closeOthers(keep) {
      for (const path of paths) {
        if (path !== keep) path.close();
      }
    }

    function hello(path) {
      path.send({ type: 'hello', cid, label: deviceLabel(), v: PROTOCOL_VERSION });
    }

    function handle(path, message) {
      if (closed || !message || typeof message !== 'object') return;
      if (message.type === 'status') {
        path.noPc = !message.pc;
        if (message.pc) {
          pcSeen = true;
          hello(path);
        }
        checkNoPc();
        return;
      }
      if (message.type === 'state') {
        pcSeen = true;
        if (message.state === 'pending' && !active) {
          report('Found the PC. Waiting for its operator to press Allow…');
        } else if (message.state === 'approved') {
          if (!active) {
            active = path;
            closeOthers(path);
            report('Allowed. Checking the AIRIZ through the PC…');
            finish(null);
          }
        } else if (['denied', 'revoked', 'busy'].includes(message.state)) {
          const text = message.state === 'denied' ? 'The PC operator denied remote control.'
            : message.state === 'revoked' ? 'The PC operator ended your remote control.'
              : 'Another device is controlling the AIRIZ right now.';
          if (!active || active === path) lost(new Error(text));
        }
        return;
      }
      if (message.type === 'rx' && path === active && onData && typeof message.data === 'string') {
        onData(encoder.encode(message.data));
        return;
      }
      if (message.type === 'ended' && (!active || active === path)) {
        lost(new Error('The PC stopped sharing control.'));
      }
    }

    function pathClosed(path) {
      path.dead = true;
      if (closed) return;
      if (active === path) lost(new Error('The connection to the PC was lost.'));
      else checkNoPc();
    }

    function checkNoPc() {
      if (active || pcSeen) return;
      if (paths.length && paths.every(path => path.dead || path.noPc || path.unavailable)) {
        lost(new Error('No PC is sharing control with code ' + code + '. Check the code on the PC (Share control).'));
      }
    }

    function startRelay() {
      const path = { kind: 'relay', dead: false, noPc: false, socket: null };
      path.send = message => {
        if (path.socket && path.socket.readyState === WebSocket.OPEN) path.socket.send(JSON.stringify(message));
      };
      path.close = () => {
        path.dead = true;
        try {
          if (path.socket) path.socket.close();
        } catch (ignored) { /* closing */ }
      };
      paths.push(path);
      try {
        path.socket = new WebSocket(RELAY_ORIGIN + '/v1/control/' + code + '?role=ctl');
      } catch (error) {
        path.dead = true;
        return;
      }
      path.socket.addEventListener('open', () => hello(path));
      path.socket.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        try {
          handle(path, JSON.parse(event.data));
        } catch (ignored) { /* not JSON */ }
      });
      path.socket.addEventListener('close', () => pathClosed(path));
    }

    function startPeer() {
      if (!PeerLib) return;
      const path = { kind: 'direct', dead: false, unavailable: false, peer: null, connection: null };
      path.send = message => {
        if (path.connection && path.connection.open) path.connection.send(message);
      };
      path.close = () => {
        path.dead = true;
        try {
          if (path.peer) path.peer.destroy();
        } catch (ignored) { /* already gone */ }
      };
      paths.push(path);
      const peer = new PeerLib({ debug: 0 });
      path.peer = peer;
      peer.on('open', () => {
        const connection = peer.connect(PEER_PREFIX + code, { reliable: true });
        path.connection = connection;
        connection.on('open', () => hello(path));
        connection.on('data', message => handle(path, message));
        connection.on('close', () => pathClosed(path));
        connection.on('error', () => pathClosed(path));
      });
      peer.on('error', error => {
        if (error && error.type === 'peer-unavailable') {
          path.unavailable = true;
          // Give the relay a moment to report the PC before giving up.
          setTimeout(checkNoPc, 4000);
          return;
        }
        pathClosed(path);
      });
    }

    return {
      label,
      async subscribe(dataCallback, lostCallback) {
        onData = dataCallback;
        onLost = lostCallback;
        report('Looking for the PC with code ' + code + '…');
        const outcome = new Promise(resolve => { settle = resolve; });
        startPeer();
        startRelay();
        const findTimer = setTimeout(() => {
          if (!pcSeen) finish(new Error('No answer from a PC with code ' + code + '. Check the code and that the PC is still sharing.'));
        }, FIND_PC_TIMEOUT_MS);
        const approveTimer = setTimeout(() => {
          finish(new Error('The PC operator did not allow the connection in time.'));
        }, APPROVAL_TIMEOUT_MS);
        const error = await outcome;
        clearTimeout(findTimer);
        clearTimeout(approveTimer);
        if (error) {
          this.close();
          throw error;
        }
      },
      async write(bytes) {
        if (!active || closed) throw new Error('Remote control is not connected.');
        active.send({ type: 'tx', cid, data: decoder.decode(bytes) });
      },
      close() {
        if (closed) return;
        if (active) active.send({ type: 'bye', cid });
        closed = true;
        finish(new Error('Connection cancelled.'));
        for (const path of paths) path.close();
      },
    };
  }

  const phone = { dialog: null, busy: false };

  function phoneBuildDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'connect-code-dialog';
    dialog.className = 'help-dialog phone-remote-dialog';
    dialog.setAttribute('aria-labelledby', 'connect-code-title');
    dialog.innerHTML = '<h2 id="connect-code-title">Connect by code</h2>'
      + '<p>Control an AIRIZ that is connected to another PC by USB - no Bluetooth needed. '
      + 'On that PC press <strong>Share control</strong>, then enter the 6-digit code here.</p>'
      + '<label class="connect-code-field">6-digit code '
      + '<input id="connect-code-input" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"></label>'
      + '<p id="connect-code-status" class="phone-remote-status" role="status"></p>'
      + '<div class="desktop-update-actions">'
      + '<button id="connect-code-go" class="btn btn-primary">Connect</button>'
      + '<button id="connect-code-cancel" class="btn btn-secondary">Close</button></div>';
    document.body.append(dialog);
    $('connect-code-go').addEventListener('click', phoneConnect);
    $('connect-code-input').addEventListener('keydown', event => {
      if (event.key === 'Enter') phoneConnect();
    });
    $('connect-code-cancel').addEventListener('click', () => {
      if (phone.cancel) phone.cancel();
      dialog.close();
    });
    phone.dialog = dialog;
    return dialog;
  }

  function phoneStatus(text) {
    const status = $('connect-code-status');
    if (status) status.textContent = text;
  }

  function phoneOpen(prefill) {
    const dialog = phone.dialog || phoneBuildDialog();
    if (prefill) $('connect-code-input').value = prefill;
    phoneStatus(api.getStatus().connected ? 'Disconnect the current device first.' : '');
    if (!dialog.open) dialog.showModal();
    $('connect-code-input').focus();
  }

  async function phoneConnect() {
    if (phone.busy) return;
    const code = ($('connect-code-input').value || '').replace(/\D/g, '');
    if (code.length !== 6) {
      phoneStatus('Enter the 6-digit code shown on the PC.');
      return;
    }
    if (api.getStatus().connected) {
      phoneStatus('Disconnect the current device first.');
      return;
    }
    phone.busy = true;
    $('connect-code-go').disabled = true;
    const link = createCodeLink(code, phoneStatus);
    phone.cancel = () => link.close();
    const port = new ble.VerifiedSerialPort(link, lostPort => {
      window.dispatchEvent(new CustomEvent('airiz-port-lost', { detail: lostPort }));
    }, VERIFY_TIMEOUT_MS);
    try {
      await api.connectPort(port);
      phoneStatus('Connected. You are controlling the AIRIZ through the PC.');
      toast('Remote control connected (code ' + code + '). Motor, LEDs, commands and macros now go through the PC.');
      setTimeout(() => {
        if (phone.dialog && phone.dialog.open) phone.dialog.close();
      }, 1200);
    } catch (error) {
      phoneStatus((error && error.message) || 'Could not connect.');
    } finally {
      phone.cancel = null;
      phone.busy = false;
      $('connect-code-go').disabled = false;
    }
  }

  // =================================================================== buttons and state
  const shareButton = $('btn-share-control');
  const codeButton = $('btn-connect-code');

  if (shareButton) {
    shareButton.addEventListener('click', () => {
      const dialog = host.dialog || hostBuildDialog();
      if (!host.code) hostSetStatus(api.getStatus().connected ? 'Press Start sharing to get a code.' : 'Connect the AIRIZ to this PC first.');
      hostRender();
      if (!dialog.open) dialog.showModal();
    });
  }
  if (codeButton) {
    codeButton.addEventListener('click', () => phoneOpen(''));
  }

  function refresh() {
    const status = api.getStatus();
    const remote = isRemoteTransport(status);
    if (shareButton) shareButton.disabled = !host.code && (!status.connected || remote);
    if (codeButton) codeButton.disabled = status.connected && !remote;
    if (codeButton) {
      const text = codeButton.querySelector('span') || codeButton;
      text.textContent = remote ? 'Remote: connected' : 'Connect by code';
    }
  }
  setInterval(refresh, 1000);
  refresh();
  setInterval(() => {
    if (host.code && host.controllers.size) hostRender();
  }, 15000);

  // Opened from a "Share control" link: index.html#control=123456 (also when the
  // console is already open and only the hash changes).
  function openFromHash() {
    const match = /(?:^|[#&])control=(\d{6})\b/.exec(location.hash || '');
    if (!match) return;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => phoneOpen(match[1]), 400);
  }
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  window.AirizRemoteControl = Object.freeze({
    createCodeLink,
    get hostCode() {
      return host.code;
    },
  });
})();
