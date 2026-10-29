/* AIRIZ remote control by code (no Bluetooth needed).
 *
 * Works like the phone camera viewer, but for the whole console:
 *   PC   (connected to the AIRIZ by USB): "Share control" -> shows a 6-digit code and a link.
 *   Phone / other PC (any browser, the Windows app or the Android app):
 *        "Connect by code" -> enter the code -> the PC operator presses Allow (or the PC lets
 *        a remembered device in by itself) -> the full console (motor, LEDs, command library,
 *        macros, audio, log) controls the AIRIZ through the PC.
 *
 * v1.9.0: several devices can control at the same time; "Allow & remember" lets a device in
 * automatically next time (the operator can switch that off and forget devices); the PC
 * stays awake while sharing; after sleep or a network drop the PC keeps the SAME code and
 * phones reconnect by themselves.
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
 * Safety: the PC operator decides who may control (Allow, or devices they chose to
 * remember); the PC can disconnect any device at any time; if a device drops shortly
 * after a motor command, the PC sends a motor stop. Lines are length- and rate-limited,
 * and the commands of all devices reach the AIRIZ one at a time.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const ble = window.AirizBle;
  const session = window.AirizRemoteSession;
  if (!api || !ble || !session) return;

  const PeerLib = window.Peer;
  const RELAY_ORIGIN = (window.AirizFrameRelay && window.AirizFrameRelay.RELAY_ORIGIN)
    || 'wss://airiz-relay.juw12.workers.dev';
  const PEER_PREFIX = 'airiz-ctl-';
  const PUBLIC_CONSOLE_URL = 'https://juw12.github.io/projects/airiz-motor/';
  const PROTOCOL_VERSION = 4; // 3 = 1.10.0 voice messages (talk / listen), 4 = 1.11.1 shared camera (PTZ)
  const MAX_LINE = 1000;
  const MAX_LINES_PER_SECOND = 25;
  const RX_CHUNK = 12000;
  const MOTOR_STOP_WINDOW_MS = 120000;
  const FIND_PC_TIMEOUT_MS = 20000;
  const APPROVAL_TIMEOUT_MS = 120000;
  const VERIFY_TIMEOUT_MS = 20000;
  const HOST_TICK_MS = 10000;          // PC: relay keepalive + health check
  const RELAY_RETRY_MS = 3000;
  const RELAY_GRACE_MS = 30000;        // relay controllers wait this long for the PC's relay socket
  const PEER_RETRY_MIN_MS = 1000;
  const PEER_RETRY_MAX_MS = 30000;
  const PEER_ID_HELD_RETRY_MS = 15000; // our own old PeerJS registration is still held after sleep
  const CONTROLLER_SILENT_MS = 75000;  // v2 devices ping every 10 s
  const PHONE_PING_MS = 10000;
  const PHONE_SILENT_MS = 30000;
  const KEEP_AWAKE_KEY = 'airiz.share.keepAwake';
  const LID_AWAKE_KEY = 'airiz.share.lidAwake';     // 1.9.1, Windows app: lid closed keeps sharing

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

  function lastUsedText(time) {
    const minutes = Math.max(0, Math.round((Date.now() - (time || 0)) / 60000));
    if (minutes < 1) return 'used just now';
    if (minutes < 60) return 'used ' + minutes + ' min ago';
    const hours = Math.round(minutes / 60);
    if (hours < 48) return 'used ' + hours + ' h ago';
    return 'used ' + Math.round(hours / 24) + ' days ago';
  }

  function controlLink(code) {
    const base = /^https?:$/.test(location.protocol) ? new URL('index.html', location.href).href : PUBLIC_CONSOLE_URL;
    return base + '#control=' + code;
  }

  function makeButton(text, className, onClick, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    if (title) button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  function makeSpan(text, className) {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    return span;
  }

  // =================================================================== PC: share control
  const trustStore = session.createTrustStore();
  const keepAwake = session.createKeepAwake({
    desktop: window.airizDesktop,
    wakeLock: navigator.wakeLock,
    document,
  });

  const host = {
    code: null,
    peer: null,
    peerOpened: false,       // the PeerJS id for this code was registered at least once
    peerRetry: null,
    peerBackoff: 0,
    peerGaveUp: false,       // PeerJS never reachable here: the relay serves, retried on wake
    relay: null,
    relayRetry: null,
    relayStale: new Map(),   // relay path key -> deadline while the PC's relay socket reconnects
    stopOutput: null,
    controllers: new Map(),  // cid -> controller
    pathOwner: new Map(),    // path key -> cid
    sessionApproved: new Map(), // device id -> key, allowed earlier while sharing this code
    queue: Promise.resolve(),   // the commands of all devices reach the AIRIZ one at a time
    dialog: null,
    watchTimer: null,
    tickTimer: null,
    usbLostAt: 0,
    power: null,              // Windows app: what the power plan does while sharing (1.9.1)
    resumed: false,           // this share continues a code from before a reload / update
    resumedApprovals: new Map(), // device id -> key hash, allowed before the reload / update
    pendingResume: null,      // a share to continue as soon as the AIRIZ is connected
    hashes: new Map(),        // device id + key -> key hash (for the resume record)
    ownCode: false,           // 1.11.4: sharing with the owner's own code (not a random one)
    ask: null,                // 1.11.4: the "asks to control" prompt
    attention: false,         // 1.11.4: someone waits for Allow (taskbar flash, tab title)
  };

  function storageOf(kind) {
    try {
      return kind === 'session' ? window.sessionStorage : window.localStorage;
    } catch (ignored) {
      return null;
    }
  }
  const SHARE_STORE = storageOf('local');
  const PHONE_STORE = storageOf('session');

  function hostBuildDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'share-control-dialog';
    dialog.className = 'help-dialog phone-remote-dialog';
    dialog.setAttribute('aria-labelledby', 'share-control-title');
    dialog.innerHTML = '<h2 id="share-control-title">Remote control by code</h2>'
      + '<p>Let a phone or another PC control this AIRIZ through this PC - no Bluetooth needed. '
      + 'On the other device open the AIRIZ console and type the code into <strong>Control by code</strong>. '
      + 'You decide who may control it.</p>'
      + '<div id="share-control-code-box" class="phone-remote-pin" hidden><span>CODE</span><strong id="share-control-code"></strong></div>'
      + '<div id="share-control-link-row" class="share-control-link-row" hidden>'
      + '<input id="share-control-link" class="input" readonly aria-label="Remote control link">'
      + '<button id="share-control-copy" class="btn">Copy link</button></div>'
      + '<p id="share-control-status" class="phone-remote-status" role="status"></p>'
      // 1.11.4: the owner's own code (like a password) instead of a new random code each time.
      + '<section class="phone-remote-clients share-own-code" aria-labelledby="share-code-title">'
      + '<h3 id="share-code-title">Your code</h3>'
      + '<p id="share-code-note" class="share-control-hint"></p>'
      + '<div class="share-code-row">'
      + '<input id="share-code-input" class="input" inputmode="numeric" autocomplete="off" maxlength="6" '
      + 'pattern="[0-9]*" placeholder="6 digits" aria-label="Your own 6-digit code">'
      + '<button id="share-code-save" class="btn btn-secondary" type="button">Use my code</button>'
      + '<button id="share-code-random" class="btn" type="button" hidden>Use random codes</button></div>'
      + '<p id="share-code-error" class="share-code-error" role="alert" hidden></p></section>'
      // Ziris PTB co-admins: ziris-team.js fills this line (auto-post to Teams) and the resend button.
      + '<div class="share-control-teams-row"><p id="share-control-teams" class="share-control-teams-status" aria-live="polite" hidden></p>'
      + '<button id="share-control-teams-send" class="btn btn-sm btn-secondary" type="button" hidden>Send to Teams</button></div>'
      + '<section class="phone-remote-clients" aria-labelledby="share-control-list-title">'
      + '<h3 id="share-control-list-title">Controllers</h3>'
      + '<p class="share-control-hint">Several phones or PCs can control at the same time. '
      + 'Allow &amp; remember lets a device in by itself next time, also after the code changes.</p>'
      + '<ul id="share-control-list" aria-live="polite"><li class="muted">Nobody yet.</li></ul></section>'
      + '<section class="phone-remote-clients share-trust" aria-labelledby="share-trust-title">'
      + '<h3 id="share-trust-title">Remembered devices</h3>'
      + '<label class="share-option"><input type="checkbox" id="share-trust-auto"> '
      + '<span>Let remembered devices in automatically (no Allow needed)</span></label>'
      + '<label class="share-option"><input type="checkbox" id="share-trust-remember"> '
      + '<span>Remember every device I allow</span></label>'
      + '<ul id="share-trust-list"></ul></section>'
      + '<label class="share-option"><input type="checkbox" id="share-keep-awake"> '
      + '<span>Keep this PC awake while sharing</span></label>'
      + '<label class="share-option" id="share-lid-row" hidden><input type="checkbox" id="share-lid-awake"> '
      + '<span>Keep sharing when the lid is closed</span></label>'
      + '<p id="share-awake-note" class="share-control-hint"></p>'
      + '<p class="help-warning">Allowed devices can move the motors and send any console command. '
      + 'Stop motor and Esc on this PC always work; a move already sent finishes unless stopped.</p>'
      + '<div class="desktop-update-actions">'
      // 1.11.0: a phone has no Esc key and this dialog covers the main Stop motor button.
      + '<button id="share-control-motor-stop" class="btn btn-danger" type="button">Stop motor</button>'
      + '<button id="share-control-start" class="btn btn-primary">Start sharing</button>'
      + '<button id="share-control-stop" class="btn" disabled>Stop sharing</button>'
      + '<button id="share-control-close" class="btn btn-secondary">Close</button></div>';
    document.body.append(dialog);
    $('share-control-motor-stop').addEventListener('click', async () => {
      const sent = await api.stopMotor();
      hostSetStatus(sent ? 'Stop sent. The motor driver halts the current move.' : 'Not connected.');
    });
    $('share-control-start').addEventListener('click', () => hostStart());
    $('share-control-stop').addEventListener('click', () => hostStop('Sharing stopped.'));
    $('share-control-close').addEventListener('click', () => dialog.close());
    $('share-control-copy').addEventListener('click', hostCopyLink);
    $('share-trust-auto').addEventListener('change', event => {
      trustStore.setAutoAllow(event.target.checked);
      toast(event.target.checked
        ? 'Remembered devices are let in automatically.'
        : 'Remembered devices now wait for Allow like any other device.');
    });
    $('share-trust-remember').addEventListener('change', event => {
      trustStore.setAutoRemember(event.target.checked);
      toast(event.target.checked
        ? 'Devices you allow are remembered and come back without asking.'
        : 'Allow lets a device in once. Use Allow & remember to remember it.');
      hostRender();
    });
    $('share-code-save').addEventListener('click', () => hostSetOwnCode($('share-code-input').value));
    $('share-code-input').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        hostSetOwnCode(event.target.value);
      }
    });
    $('share-code-random').addEventListener('click', hostUseRandomCodes);
    $('share-keep-awake').checked = keepAwakeWanted();
    $('share-keep-awake').addEventListener('change', event => {
      try {
        localStorage.setItem(KEEP_AWAKE_KEY, event.target.checked ? '1' : '0');
      } catch (ignored) { /* storage blocked: applies to this session only */ }
      hostApplyKeepAwake();
    });
    $('share-lid-row').hidden = !desktopPower();
    $('share-lid-awake').checked = lidWanted();
    $('share-lid-awake').addEventListener('change', event => {
      try {
        localStorage.setItem(LID_AWAKE_KEY, event.target.checked ? '1' : '0');
      } catch (ignored) { /* storage blocked: applies to this session only */ }
      hostApplyKeepAwake();
    });
    host.dialog = dialog;
    hostRenderTrust();
    hostRenderOwnCode();
    hostRenderAwake();
    document.dispatchEvent(new CustomEvent('airiz:share-dialog'));
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

  function approvedControllers() {
    return [...host.controllers.values()].filter(controller => controller.state === 'approved');
  }

  function pathText(controller) {
    const keys = [...controller.paths.keys()];
    const direct = keys.some(key => key.startsWith('p:'));
    const relay = keys.some(key => key.startsWith('r:') && !host.relayStale.has(key));
    if (direct && relay) return 'direct + relay';
    if (direct) return 'direct';
    if (relay) return 'via AIRIZ relay';
    return 'reconnecting…';
  }

  function hostRender() {
    const list = $('share-control-list');
    const button = $('btn-share-control');
    const approved = approvedControllers();
    const pending = [...host.controllers.values()].filter(item => item.state === 'pending').length;
    if (button) {
      const label = button.querySelector('span') || button;
      let text = 'Share control';
      if (host.code) {
        if (approved.length === 1) text = 'Shared · ' + approved[0].label;
        else if (approved.length > 1) text = 'Shared · ' + approved.length + ' devices';
        else if (pending) text = 'Share control · ' + pending + ' waiting';
        else text = 'Sharing control';
      }
      label.textContent = text;
      button.classList.toggle('btn-primary', !!host.code);
      button.classList.toggle('btn-secondary', !host.code);
    }
    if (!list) return;
    const rows = [...host.controllers.values()].filter(controller => controller.state !== 'ended').map(controller => {
      const item = document.createElement('li');
      item.dataset.cid = controller.cid;
      item.dataset.state = controller.state;
      const name = document.createElement('strong');
      name.textContent = controller.label;
      item.append(name);
      if (controller.remembered) item.append(makeSpan('remembered', 'share-badge is-remembered'));
      if (controller.trust === 'mismatch') item.append(makeSpan('key changed', 'share-badge is-warning'));
      const meta = document.createElement('span');
      meta.className = 'share-row-meta';
      const stateText = controller.state === 'approved' ? 'controlling'
        : controller.trust === 'checking' ? 'checking…' : 'asks to control';
      meta.append(makeSpan(stateText), makeSpan(pathText(controller)), makeSpan(ageText(controller.since)));
      item.append(meta);
      if (controller.state === 'pending') {
        item.append(...decisionButtons(controller));
      } else {
        if (controller.device && !controller.remembered) {
          item.append(makeButton('Remember', 'btn btn-secondary share-remember',
            () => hostRememberController(controller.cid), 'Let this device in by itself next time'));
        }
        item.append(makeButton('Disconnect', 'btn btn-danger', () => hostDeny(controller.cid, 'revoked')));
      }
      return item;
    });
    list.replaceChildren(...(rows.length ? rows
      : [Object.assign(document.createElement('li'), { className: 'muted', textContent: host.code ? 'Waiting for a device to connect…' : 'Nobody yet.' })]));
    hostRenderAsk();
  }

  // 1.11.4: one set of decision buttons for the Controllers list and the "asks to control" prompt.
  // With "Remember every device I allow" (default on) the main button remembers the device.
  function decisionButtons(controller) {
    const cid = controller.cid;
    const buttons = [];
    const canRemember = !!controller.device;
    if (canRemember && trustStore.autoRemember) {
      buttons.push(makeButton('Allow & remember', 'btn btn-primary share-allow-remember',
        () => hostApprove(cid, { remember: true }),
        'Allow now and let this device in by itself next time'));
      buttons.push(makeButton('Allow once', 'btn btn-secondary share-allow-once',
        () => hostApprove(cid, { remember: false }), 'Allow now; ask again next time'));
    } else {
      buttons.push(makeButton('Allow', 'btn btn-primary share-allow',
        () => hostApprove(cid, { remember: false })));
      if (canRemember) {
        buttons.push(makeButton('Allow & remember', 'btn btn-secondary share-allow-remember',
          () => hostApprove(cid, { remember: true }),
          'Allow now and let this device in by itself next time'));
      }
    }
    buttons.push(makeButton('Deny', 'btn share-deny', () => hostDeny(cid, 'denied')));
    if (!canRemember) {
      buttons.push(makeSpan('This device cannot be remembered (its browser keeps no data).', 'share-row-note'));
    }
    return buttons;
  }

  function pendingControllers() {
    return [...host.controllers.values()].filter(controller => controller.state === 'pending' && controller.trust !== 'checking');
  }

  // A prompt on top of everything else, so a request is never just a toast that goes away.
  function hostBuildAsk() {
    const dialog = document.createElement('dialog');
    dialog.id = 'share-ask-dialog';
    dialog.className = 'help-dialog share-ask-dialog';
    dialog.setAttribute('aria-labelledby', 'share-ask-title');
    dialog.innerHTML = '<h2 id="share-ask-title">A device asks to control the AIRIZ</h2>'
      + '<ul id="share-ask-list" class="share-ask-list"></ul>'
      + '<p class="share-control-hint">Allow &amp; remember lets the device in by itself next time, also after the code changes. '
      + 'Forget it any time in Share control.</p>'
      + '<div class="desktop-update-actions">'
      + '<button id="share-ask-later" class="btn btn-secondary" type="button">Decide later</button></div>';
    document.body.append(dialog);
    $('share-ask-later').addEventListener('click', () => dialog.close());
    host.ask = dialog;
    return dialog;
  }

  function hostRenderAsk() {
    const pending = host.code ? pendingControllers() : [];
    hostAttention(pending.length);
    const dialog = host.ask;
    if (!dialog) return;
    if (!pending.length) {
      if (dialog.open) dialog.close();
      return;
    }
    $('share-ask-list').replaceChildren(...pending.map(controller => {
      const item = document.createElement('li');
      item.dataset.cid = controller.cid;
      const name = document.createElement('strong');
      name.textContent = controller.label;
      item.append(name);
      if (controller.trust === 'mismatch') {
        item.append(makeSpan('key changed', 'share-badge is-warning'),
          makeSpan('Its key does not match the remembered device. Check it before allowing.', 'share-row-note'));
      }
      const meta = document.createElement('span');
      meta.className = 'share-row-meta';
      meta.append(makeSpan('asks to control'), makeSpan(pathText(controller)), makeSpan(ageText(controller.since)));
      const actions = document.createElement('span');
      actions.className = 'share-ask-actions';
      actions.append(...decisionButtons(controller));
      item.append(meta, actions);
      return item;
    }));
  }

  // A new request: show it where the owner is looking. The Share control dialog, when open,
  // already lists it (scrolled into view); otherwise the prompt opens on top of the page.
  function hostShowRequest(controller) {
    if (host.dialog && host.dialog.open) {
      const row = document.querySelector('#share-control-list li[data-cid="' + controller.cid + '"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
      return;
    }
    const dialog = host.ask || hostBuildAsk();
    hostRenderAsk();
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch (ignored) {
        dialog.setAttribute('open', '');
      }
    }
    const first = dialog.querySelector('button.btn-primary');
    if (first) first.focus();
  }

  // Taskbar flash (Windows app) and a tab title mark while someone waits for Allow.
  function hostAttention(count) {
    const waiting = count > 0;
    if (host.attention === waiting) return;
    host.attention = waiting;
    const mark = '(!) ';
    if (waiting && !document.title.startsWith(mark)) document.title = mark + document.title;
    if (!waiting && document.title.startsWith(mark)) document.title = document.title.slice(mark.length);
    const desktop = window.airizDesktop;
    if (desktop && typeof desktop.requestAttention === 'function') {
      try {
        const pending = desktop.requestAttention(waiting);
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (ignored) { /* older desktop build */ }
    }
  }

  // ------------------------------------------------------------------ PC: the owner's own code (1.11.4)
  function hostRenderOwnCode() {
    const note = $('share-code-note');
    if (!note) return;
    const own = session.loadOwnCode(SHARE_STORE);
    note.replaceChildren();
    if (own) {
      note.append(makeSpan('Your own code:'), document.createTextNode(' '),
        Object.assign(document.createElement('strong'), { className: 'share-own-code-value', textContent: own }),
        document.createTextNode(' '),
        makeSpan('It is used every time you share, like a password. Change it any time; the old code then stops working.'));
    } else {
      note.append(makeSpan('A new random code is made each time you share. '
        + 'Type your own 6 digits to keep one code, like a password you can change any time.'));
    }
    $('share-code-random').hidden = !own;
    $('share-code-save').textContent = own ? 'Change code' : 'Use my code';
    $('share-code-input').placeholder = own ? 'New 6 digits' : '6 digits';
  }

  function hostCodeError(text) {
    const error = $('share-code-error');
    if (!error) return;
    error.textContent = text || '';
    error.hidden = !text;
  }

  function hostSetOwnCode(value) {
    const result = session.saveOwnCode(SHARE_STORE, String(value || '').replace(/[\s-]/g, ''));
    if (!result.ok) {
      hostCodeError(result.reason === 'easy'
        ? 'That code is too easy to guess, and another AIRIZ owner may pick it too. Try less obvious digits.'
        : result.reason === 'storage'
          ? 'This browser could not save the code (storage blocked).'
          : 'Use exactly 6 digits.');
      return result;
    }
    hostCodeError('');
    $('share-code-input').value = '';
    hostRenderOwnCode();
    const code = result.code;
    if (host.code && host.code !== code) {
      hostChangeCode(code);
    } else if (host.code) {
      host.ownCode = true;
      toast('You are already sharing with code ' + code + '. It stays your code.');
    } else {
      toast('Saved. Your code ' + code + ' is used every time you share.');
    }
    return result;
  }

  function hostUseRandomCodes() {
    session.clearOwnCode(SHARE_STORE);
    hostCodeError('');
    hostRenderOwnCode();
    toast(host.code
      ? 'Random codes from the next time you share. The current code keeps working until you stop sharing.'
      : 'A new random code is made each time you share.');
  }

  // Sharing moves to the new code at once: devices on the old code are disconnected and told the
  // code changed. Remembered devices are let in by themselves once they type the new code.
  function hostChangeCode(code) {
    hostStop(null, true, { reason: 'code-changed' });
    hostStart(0, { code, own: true });
    if (host.code === code) {
      const text = 'Code changed to ' + code + '. Devices on the old code were disconnected; '
        + 'tell the people you trust the new code.';
      hostSetStatus(text);
      toast(text);
    }
  }

  function hostRenderTrust() {
    const auto = $('share-trust-auto');
    const list = $('share-trust-list');
    if (!auto || !list) return;
    auto.checked = trustStore.autoAllow;
    const rememberAll = $('share-trust-remember');
    if (rememberAll) rememberAll.checked = trustStore.autoRemember;
    const devices = trustStore.list();
    if (!devices.length) {
      list.replaceChildren(Object.assign(document.createElement('li'), {
        className: 'muted',
        textContent: 'No remembered devices yet.',
      }));
      return;
    }
    list.replaceChildren(...devices.map(device => {
      const item = document.createElement('li');
      item.dataset.device = device.id;
      const name = document.createElement('strong');
      name.textContent = device.name;
      const meta = document.createElement('span');
      meta.className = 'share-row-meta';
      meta.append(makeSpan(lastUsedText(device.lastSeen)));
      item.append(name, meta, makeButton('Forget', 'btn share-forget', () => hostForget(device.id)));
      return item;
    }));
  }

  function keepAwakeWanted() {
    try {
      return localStorage.getItem(KEEP_AWAKE_KEY) !== '0';
    } catch (ignored) {
      return true;
    }
  }

  function lidWanted() {
    try {
      return localStorage.getItem(LID_AWAKE_KEY) !== '0';
    } catch (ignored) {
      return true;
    }
  }

  // Windows app 1.9.1+: lid and sleep-timer control through the main process.
  function desktopPower() {
    const desktop = window.airizDesktop;
    return desktop && typeof desktop.setLidAwake === 'function' ? desktop : null;
  }

  // One sentence per line of the note, so each is translated on its own.
  function hostAwakeLines(active) {
    const wanted = keepAwakeWanted();
    const power = host.power || {};
    const lines = [];
    if (keepAwake.mode === 'desktop') {
      if (!wanted) {
        lines.push('The PC may go to sleep while sharing. Phones reconnect with the same code when it wakes up.');
      } else if (host.code && active === false) {
        lines.push('Windows did not accept the keep-awake request. Set sleep to Never while sharing.');
      } else if (power.sleep === 'failed') {
        lines.push('While sharing, this PC stays awake while plugged in. Windows did not allow changing its sleep timer, so on battery it may still sleep.');
      } else if (power.sleep === 'managed') {
        lines.push('While sharing, this PC stays awake. Your IT settings control its sleep timer.');
      } else {
        lines.push('While sharing, this PC does not go to sleep, also on battery (its sleep timer is set to Never).');
      }
      if (wanted) {
        lines.push(power.standby === 'classic'
          ? 'The screen can still turn off by itself; sharing goes on.'
          : 'The screen stays on, because on this PC an idle screen can end in standby.');
      }
      if (desktopPower()) {
        if (!lidWanted()) {
          lines.push('Closing the lid puts this PC to sleep; phones reconnect with the same code when it wakes up.');
        } else if (power.lid === 'managed') {
          lines.push('Your IT settings control the lid: closing it puts this PC to sleep; phones reconnect when it wakes up.');
        } else if (power.lid === 'failed') {
          lines.push('Windows did not allow changing the lid setting: closing the lid puts this PC to sleep; phones reconnect when it wakes up.');
        } else {
          lines.push('Closing the lid does not stop the share: close it to turn the screen off.');
        }
        lines.push('Your own power settings come back when you stop sharing.');
      } else {
        lines.push('Closing the lid can still put it to sleep; it then reconnects with the same code when it wakes up.');
      }
    } else if (!wanted) {
      lines.push('The PC may go to sleep while sharing. Phones reconnect with the same code when it wakes up.');
    } else if (keepAwake.mode === 'screen') {
      lines.push('This browser keeps the screen on while this tab is visible. The AIRIZ Windows app also keeps the PC awake in the background.');
    } else {
      lines.push('This browser cannot keep the PC awake. Use the AIRIZ Windows app, or set Windows sleep to Never while sharing.');
    }
    return lines;
  }

  function hostRenderAwake(active) {
    const note = $('share-awake-note');
    if (!note) return;
    const lines = hostAwakeLines(active);
    note.replaceChildren(...lines.map((line, index) => {
      const span = makeSpan(line, 'share-awake-line');
      return index ? [document.createTextNode(' '), span] : [span];
    }).flat());
    const lidRow = $('share-lid-row');
    if (lidRow) lidRow.hidden = !desktopPower();
  }

  // In the Windows app, a shared console must keep running at full speed
  // even when its window is minimised or hidden behind other windows.
  function hostApplyBackgroundSharing() {
    const desktop = window.airizDesktop;
    if (!desktop || typeof desktop.setSharing !== 'function') return;
    try {
      const pending = desktop.setSharing(!!host.code);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (ignored) { /* older desktop build */ }
  }

  async function hostApplyKeepAwake() {
    hostApplyBackgroundSharing();
    const wanted = !!host.code && keepAwakeWanted();
    const active = await keepAwake.set(wanted);
    const desktop = desktopPower();
    if (desktop) {
      try {
        // The lid change waits for the sleep-timer change queued by setKeepAwake.
        await desktop.setLidAwake(!!host.code && lidWanted());
        if (typeof desktop.getPowerStatus === 'function') host.power = await desktop.getPowerStatus();
      } catch (ignored) { /* older desktop build */ }
    }
    hostRenderAwake(wanted ? active : undefined);
  }

  function hostSend(controller, message) {
    for (const send of controller.paths.values()) {
      try {
        send(message);
      } catch (ignored) { /* path closing */ }
    }
  }

  function hostBroadcast(message, onlyApproved) {
    for (const controller of host.controllers.values()) {
      if (onlyApproved && controller.state !== 'approved') continue;
      hostSend(controller, message);
    }
  }

  // 1.11.1: the camera position this console tracks (ptz.js) counts every move, also those of
  // the devices that control through it. Each allowed device gets it, so their Go home and
  // saved positions start from where the real camera is.
  function hostSendPtz(controller) {
    const ptz = window.AirizPtz;
    if (!ptz || typeof ptz.shared !== 'function') return;
    hostSend(controller, { type: 'ptz-state', state: ptz.shared() });
  }

  let hostPtzWatched = false;
  function hostWatchPtz() {
    const ptz = window.AirizPtz;
    if (hostPtzWatched || !ptz || typeof ptz.onShared !== 'function') return;
    hostPtzWatched = true;
    ptz.onShared(state => hostBroadcast({ type: 'ptz-state', state }, true));
  }

  // Device output goes to every allowed device.
  function hostForwardOutput(text) {
    if (!text) return;
    const targets = approvedControllers();
    if (!targets.length) return;
    for (let offset = 0; offset < text.length; offset += RX_CHUNK) {
      const message = { type: 'rx', data: text.slice(offset, offset + RX_CHUNK) };
      for (const controller of targets) hostSend(controller, message);
    }
  }

  function hostStatusAfterChange() {
    const approved = approvedControllers();
    if (approved.length === 1) {
      hostSetStatus(approved[0].label + ' is controlling the AIRIZ. Commands it sends appear in the Live console.');
    } else if (approved.length > 1) {
      hostSetStatus(approved.length + ' devices are controlling the AIRIZ. Commands they send appear in the Live console.');
    }
  }

  async function hostApprove(cid, options) {
    const settings = options || {};
    const controller = host.controllers.get(cid);
    if (!controller || controller.state !== 'pending') return;
    controller.state = 'approved';
    controller.since = Date.now();
    controller.lastHeard = Date.now();
    if (controller.device) host.sessionApproved.set(controller.device.id, controller.device.key);
    hostPersistShare('running');
    if (settings.remember && controller.device) {
      const saved = await trustStore.remember(controller.device.id, controller.device.key, controller.label);
      if (saved) {
        controller.remembered = true;
        controller.trust = 'remembered';
      }
      hostRenderTrust();
    }
    if (!host.controllers.has(cid)) return;
    hostDropOlderLinks(controller);
    hostSend(controller, { type: 'state', state: 'approved', remembered: !!controller.remembered, pc: deviceLabel(), v: PROTOCOL_VERSION });
    hostWatchPtz();
    hostSendPtz(controller);
    const count = approvedControllers().length;
    let note;
    if (settings.auto === 'auto-remembered') {
      note = controller.label + ' (remembered) is controlling the AIRIZ - let in automatically.';
    } else if (settings.auto === 'auto-session') {
      note = controller.label + ' reconnected and is controlling the AIRIZ again.';
    } else {
      note = controller.label + ' is now controlling the AIRIZ through this PC.';
    }
    if (count > 1) note += ' ' + count + ' devices are controlling.';
    toast(note);
    hostStatusAfterChange();
    hostRender();
  }

  // The same device reconnected with a new link: the old link is gone, drop it quietly
  // (no safety stop - the device is back and can stop the motor itself).
  function hostDropOlderLinks(controller) {
    if (!controller.device) return;
    for (const other of [...host.controllers.values()]) {
      if (other !== controller && other.device && other.device.id === controller.device.id) {
        hostDropController(other.cid, null, { silent: true });
      }
    }
  }

  async function hostRememberController(cid) {
    const controller = host.controllers.get(cid);
    if (!controller || !controller.device) return;
    const saved = await trustStore.remember(controller.device.id, controller.device.key, controller.label);
    if (saved) {
      controller.remembered = true;
      controller.trust = 'remembered';
      toast(trustStore.autoAllow
        ? controller.label + ' is remembered and will be let in automatically next time.'
        : controller.label + ' is remembered.');
    } else {
      toast('This device could not be remembered here (secure storage unavailable).');
    }
    hostRender();
    hostRenderTrust();
  }

  function hostForget(deviceId) {
    trustStore.forget(deviceId);
    host.sessionApproved.delete(deviceId);
    for (const controller of host.controllers.values()) {
      if (controller.device && controller.device.id === deviceId) {
        controller.remembered = false;
        controller.trust = 'unknown';
      }
    }
    toast('Forgotten. That device needs your Allow next time.');
    hostRender();
    hostRenderTrust();
  }

  function hostDeny(cid, reason) {
    const controller = host.controllers.get(cid);
    if (!controller) return;
    if (controller.device) host.sessionApproved.delete(controller.device.id);
    hostSend(controller, { type: 'state', state: reason });
    hostDropController(cid, reason === 'revoked' ? 'Disconnected ' + controller.label + '.' : 'Denied ' + controller.label + '.');
  }

  async function hostDropController(cid, note, options) {
    const settings = options || {};
    const controller = host.controllers.get(cid);
    if (!controller) return;
    host.controllers.delete(cid);
    if (window.AirizVoice && typeof window.AirizVoice.hostClientGone === 'function') {
      try {
        window.AirizVoice.hostClientGone(cid);
      } catch (voiceError) {
        console.error(voiceError);
      }
    }
    for (const [key, closer] of controller.closers) {
      host.pathOwner.delete(key);
      try {
        closer();
      } catch (ignored) { /* already closed */ }
    }
    for (const key of controller.paths.keys()) {
      host.pathOwner.delete(key);
      host.relayStale.delete(key);
    }
    if (!settings.silent && controller.state === 'approved' && Date.now() - controller.lastMotorAt < MOTOR_STOP_WINDOW_MS) {
      const sent = await api.stopMotor();
      toast((note || controller.label + ' left.') + (sent ? ' Motor stop sent for safety.' : ''));
    } else if (note && !settings.silent) {
      toast(note);
    }
    if (note && !settings.silent) hostSetStatus(note);
    hostRender();
  }

  // Decide what to do with a new control request: let it in, or ask the operator.
  async function hostScreen(controller) {
    const device = controller.device;
    let trust = 'unknown';
    if (device) {
      try {
        const result = await trustStore.check(device.id, device.key);
        trust = result.status;
      } catch (ignored) {
        trust = 'unknown';
      }
    }
    if (!host.controllers.has(controller.cid)) return; // left meanwhile
    controller.trust = trust;
    controller.remembered = trust === 'remembered';
    if (controller.remembered) trustStore.touch(device.id, controller.label);
    let sessionApproved = !!device && host.sessionApproved.get(device.id) === device.key;
    if (!sessionApproved && device && host.resumedApprovals.has(device.id)) {
      // Allowed before this console reloaded or restarted for an update (same code).
      try {
        sessionApproved = (await session.hashKey(device.key)) === host.resumedApprovals.get(device.id);
      } catch (ignored) {
        sessionApproved = false;
      }
      if (!host.controllers.has(controller.cid)) return;
    }
    const decision = session.decide({ trust, autoAllow: trustStore.autoAllow, sessionApproved });
    if (decision === 'auto-remembered' || decision === 'auto-session') {
      await hostApprove(controller.cid, { auto: decision });
      hostRenderTrust();
      return;
    }
    hostSend(controller, { type: 'state', state: 'pending', pc: deviceLabel(), v: PROTOCOL_VERSION });
    toast(decision === 'ask-warning'
      ? controller.label + ' asks to control the AIRIZ, but its key does not match the remembered device. Check it before allowing.'
      : controller.label + ' asks to control the AIRIZ.');
    hostRender();
    // 1.11.4: Allow / Allow & remember / Deny right where the owner is looking (was: only the
    // list inside Share control, which a toast pointed to).
    hostShowRequest(controller);
  }

  // A transport path (one PeerJS connection or one relay controller id) said something.
  function hostReceive(pathKey, send, closer, message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello') {
      const cid = cleanId(message.cid) || pathKey;
      let controller = host.controllers.get(cid);
      const isNew = !controller;
      if (isNew) {
        const deviceId = String(message.device || '');
        const deviceKey = String(message.key || '');
        controller = {
          cid,
          label: cleanLabel(message.label) || 'Remote device',
          state: 'pending',
          since: Date.now(),
          paths: new Map(),
          closers: new Map(),
          lastMotorAt: 0,
          lastHeard: Date.now(),
          buffer: '',
          lineTimes: [],
          version: Number(message.v) || 1,
          device: session.validIdentity(deviceId, deviceKey) ? { id: deviceId, key: deviceKey } : null,
          trust: 'checking',
          remembered: false,
        };
        host.controllers.set(cid, controller);
      }
      controller.paths.set(pathKey, send);
      if (closer) controller.closers.set(pathKey, closer);
      host.pathOwner.set(pathKey, cid);
      host.relayStale.delete(pathKey);
      controller.lastHeard = Date.now();
      if (isNew) {
        hostRender();
        hostScreen(controller);
      } else if (controller.trust !== 'checking') {
        send({ type: 'state', state: controller.state === 'approved' ? 'approved' : 'pending',
          remembered: !!controller.remembered, pc: deviceLabel(), v: PROTOCOL_VERSION });
        if (controller.state === 'approved') hostSendPtz(controller);
        hostRender();
      }
      return;
    }
    const cid = host.pathOwner.get(pathKey);
    const controller = cid && host.controllers.get(cid);
    if (!controller) return;
    controller.lastHeard = Date.now();
    if (message.type === 'ping') {
      send({ type: 'pong' });
      return;
    }
    if (message.type === 'bye') {
      if (controller.device) host.sessionApproved.delete(controller.device.id);
      hostDropController(cid, controller.label + ' disconnected.');
      return;
    }
    if (message.type === 'tx' && controller.state === 'approved' && typeof message.data === 'string') {
      hostAcceptText(controller, message.data);
      return;
    }
    // 1.11.1: Go home, Set home, soft limits and the rising switch asked for by an allowed
    // device run here, where every move is known ("sync" = send the camera state again).
    if (message.type === 'ptz-action' && controller.state === 'approved') {
      const action = String(message.action || '');
      if (action === 'sync') {
        hostSendPtz(controller);
      } else if (window.AirizPtz && typeof window.AirizPtz.runShared === 'function') {
        try {
          window.AirizPtz.runShared(action, message.args, controller.label);
        } catch (ptzError) {
          console.error(ptzError);
        }
      }
      return;
    }
    // 1.10.0: talk to the AIRIZ speaker / listen to its microphone (audio-ui.js does the work)
    if (typeof message.type === 'string' && message.type.startsWith('voice-')) {
      if (controller.state !== 'approved') return;
      const voice = window.AirizVoice;
      if (voice && typeof voice.hostMessage === 'function') {
        try {
          voice.hostMessage(hostVoiceClient(controller), message);
        } catch (voiceError) {
          console.error(voiceError);
        }
      } else {
        hostSend(controller, { type: 'voice-state', state: 'unsupported' });
      }
    }
  }

  function hostVoiceClient(controller) {
    if (!controller.voiceClient) {
      controller.voiceClient = {
        id: controller.cid,
        get label() {
          return controller.label;
        },
        get connected() {
          return host.controllers.get(controller.cid) === controller && controller.state === 'approved';
        },
        send(message) {
          hostSend(controller, message);
        },
      };
    }
    return controller.voiceClient;
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
    host.queue = host.queue.then(async () => {
      if (!host.controllers.has(controller.cid) || controller.state !== 'approved') return;
      // The phone sends the USB stop command; let this PC use its own stop for its transport.
      if (line.trim() === ble.MOTOR_STOP_USB) {
        await api.stopMotor();
        return;
      }
      if (api.getStatus().reconnecting) {
        hostSend(controller, { type: 'rx', data: '\r\n[PC] The AIRIZ USB connection is reconnecting - command not sent.\r\n' });
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
    host.relayStale.delete(pathKey);
    const controller = cid && host.controllers.get(cid);
    if (!controller) return;
    controller.paths.delete(pathKey);
    controller.closers.delete(pathKey);
    if (controller.paths.size === 0) hostDropController(cid, controller.label + ' disconnected.');
    else hostRender();
  }

  // ------------------------------------------------------------------ PC: PeerJS path
  function hostStartPeer(code, attempt) {
    if (!PeerLib || host.code !== code) return;
    clearTimeout(host.peerRetry);
    host.peerRetry = null;
    let peer;
    try {
      peer = new PeerLib(PEER_PREFIX + code, { debug: 0 });
    } catch (error) {
      hostRecreatePeer(code, 'failed');
      return;
    }
    host.peer = peer;
    peer.on('open', () => {
      if (host.peer !== peer) return;
      host.peerOpened = true;
      host.peerBackoff = 0;
    });
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
      if (error && error.type === 'unavailable-id') {
        if (!host.peerOpened && attempt < 3 && !host.resumed && !host.ownCode) {
          // Another PC already uses this code on the PeerJS server: start over with a new code.
          hostStop(null, true);
          hostStart(attempt + 1);
          return;
        }
        // Our own registration from before a sleep is still held (or, for the owner's own code,
        // another console holds it - the relay check below stops one of them): keep the code.
        hostRecreatePeer(code, 'id-held');
      }
      // Other PeerJS errors: the AIRIZ relay keeps serving controllers; the health check repairs this.
    });
    peer.on('disconnected', () => {
      if (host.peer !== peer || peer.destroyed || host.asleep) return;
      hostSchedulePeerReconnect(peer);
    });
    peer.on('close', () => {
      if (host.peer !== peer || host.asleep) return;
      hostRecreatePeer(code, 'closed');
    });
  }

  function hostPeerDelay() {
    const delay = Math.min(PEER_RETRY_MAX_MS, PEER_RETRY_MIN_MS * Math.pow(2, host.peerBackoff));
    host.peerBackoff = Math.min(host.peerBackoff + 1, 10);
    return delay;
  }

  // Lost the PeerJS server (sleep, Wi-Fi change): re-register the SAME code with the same token.
  function hostSchedulePeerReconnect(peer) {
    if (host.peerRetry) return;
    host.peerRetry = setTimeout(() => {
      host.peerRetry = null;
      if (host.peer !== peer || peer.destroyed || !peer.disconnected) return;
      try {
        peer.reconnect();
      } catch (error) {
        hostRecreatePeer(host.code, 'failed');
      }
    }, hostPeerDelay());
  }

  function hostRecreatePeer(code, why) {
    if (host.code !== code) return;
    const old = host.peer;
    host.peer = null;
    if (old && !old.destroyed) {
      try {
        old.destroy();
      } catch (ignored) { /* already gone */ }
    }
    clearTimeout(host.peerRetry);
    host.peerRetry = null;
    if (!host.peerOpened && host.peerBackoff >= 6) {
      // The PeerJS server was never reachable from here: the relay carries everything.
      host.peerGaveUp = true;
      return;
    }
    const delay = why === 'id-held' ? PEER_ID_HELD_RETRY_MS : hostPeerDelay();
    host.peerRetry = setTimeout(() => {
      host.peerRetry = null;
      hostStartPeer(code, 99);
    }, delay);
  }

  function hostEnsurePeer(reason) {
    if (!host.code || !PeerLib) return;
    if (reason !== 'watchdog') host.peerGaveUp = false;
    if (host.peerGaveUp) return;
    const peer = host.peer;
    if (!peer || peer.destroyed) {
      if (!host.peerRetry) hostStartPeer(host.code, 99);
      return;
    }
    if (peer.disconnected) {
      if (reason !== 'watchdog') {
        clearTimeout(host.peerRetry);
        host.peerRetry = null;
        host.peerBackoff = 0;
      }
      hostSchedulePeerReconnect(peer);
    }
  }

  // ------------------------------------------------------------------ PC: AIRIZ relay path
  function hostRelaySender(from) {
    return reply => {
      const socket = host.relay;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(Object.assign({}, reply, { to: from })));
    };
  }

  function hostStartRelay(code) {
    if (host.code !== code) return;
    clearTimeout(host.relayRetry);
    host.relayRetry = null;
    let socket;
    try {
      socket = new WebSocket(RELAY_ORIGIN + '/v1/control/' + code + '?role=pc');
    } catch (error) {
      host.relayRetry = setTimeout(() => hostStartRelay(code), RELAY_RETRY_MS);
      return;
    }
    const previous = host.relay;
    host.relay = socket;
    if (previous) {
      // Replaced on purpose (e.g. after sleep the old socket may be half-open).
      hostRelayDetached();
      try {
        previous.close();
      } catch (ignored) { /* closing */ }
    }
    socket.addEventListener('message', event => {
      if (host.relay !== socket || typeof event.data !== 'string') return;
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
        hostPathClosed(key);
        return;
      }
      host.relayStale.delete(key);
      hostReceive(key, hostRelaySender(from), null, message);
    });
    socket.addEventListener('close', event => {
      if (host.relay !== socket) return;
      host.relay = null;
      // 1.11.4: the relay closes a PC socket with 4000 when another PC joins the same code. With a
      // random code that is our own newer socket (handled above); with the owner's own code it can
      // be another console using the same code: stop here instead of taking turns with it.
      if (event && event.code === 4000 && host.ownCode && host.code === code) {
        hostCodeTaken(code);
        return;
      }
      hostRelayDetached();
      if (host.code === code && !host.asleep) host.relayRetry = setTimeout(() => hostStartRelay(code), RELAY_RETRY_MS);
    });
  }

  function hostCodeTaken(code) {
    hostStop(null, true);
    const text = 'Code ' + code + ' is now shared by another AIRIZ console (another PC or window), so sharing stopped here. '
      + 'Choose a different code in Share control, then Start sharing.';
    hostSetStatus(text);
    toast(text);
    if (host.dialog && !host.dialog.open) {
      try {
        host.dialog.showModal();
      } catch (ignored) { /* another modal is open */ }
    }
  }

  // The PC's relay socket closed or was replaced. Devices on the relay keep their place for a
  // short grace: when the socket is back, the relay asks them to say hello again.
  function hostRelayDetached() {
    const deadline = Date.now() + RELAY_GRACE_MS;
    let motorRisk = false;
    for (const [key, cid] of host.pathOwner) {
      if (!key.startsWith('r:') || host.relayStale.has(key)) continue;
      host.relayStale.set(key, deadline);
      const controller = host.controllers.get(cid);
      const relayOnly = controller && [...controller.paths.keys()].every(path => path.startsWith('r:'));
      if (relayOnly && controller.state === 'approved' && Date.now() - controller.lastMotorAt < MOTOR_STOP_WINDOW_MS) {
        controller.lastMotorAt = 0;
        motorRisk = true;
      }
    }
    if (motorRisk) {
      api.stopMotor().then(sent => {
        if (sent) toast('The relay connection dropped right after a motor command - motor stop sent for safety.');
      });
    }
    hostRender();
  }

  function hostExpireRelayPaths() {
    const now = Date.now();
    for (const [key, deadline] of [...host.relayStale]) {
      if (now < deadline) continue;
      host.relayStale.delete(key);
      hostPathClosed(key);
    }
  }

  function hostDropSilentControllers() {
    const now = Date.now();
    for (const controller of [...host.controllers.values()]) {
      if (controller.version >= 2 && now - controller.lastHeard > CONTROLLER_SILENT_MS) {
        hostDropController(controller.cid, controller.label + ' stopped answering.');
      }
    }
  }

  // Every 10 s while sharing: keep the relay socket alive (and notice a dead one), repair the
  // PeerJS registration, expire stale relay paths and devices that stopped answering.
  function hostTick() {
    if (!host.code || host.asleep) return;
    const socket = host.relay;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'keepalive', to: '-' }));
      } catch (ignored) { /* closing */ }
    } else if (!socket && !host.relayRetry) {
      hostStartRelay(host.code);
    }
    hostEnsurePeer('watchdog');
    hostExpireRelayPaths();
    hostDropSilentControllers();
    hostPersistShare('running');
  }

  // After sleep / network change: same code, fresh connections. Nothing is torn down that
  // still works; devices that lost their link reconnect by themselves.
  function hostRecover(reason) {
    if (!host.code) return false;
    const now = Date.now();
    for (const controller of host.controllers.values()) controller.lastHeard = now;
    hostStartRelay(host.code);
    hostEnsurePeer(reason || 'wake');
    if (typeof api.probe === 'function') api.probe();
    hostApplyKeepAwake();
    hostSetStatus('Reconnecting the share after sleep or a network change - same code ' + host.code + '.');
    setTimeout(() => {
      if (host.code) hostSetStatus('Sharing with code ' + host.code + '. Phones reconnect by themselves.');
    }, 6000);
    return true;
  }

  // The AIRIZ USB link: keep the code while app.js reconnects the device by itself.
  function hostWatch() {
    if (!host.code) return;
    const status = api.getStatus();
    if (status.connected) {
      if (host.usbLostAt) {
        host.usbLostAt = 0;
        hostBroadcast({ type: 'rx', data: '\r\n[PC] The AIRIZ is connected again.\r\n' }, true);
        hostSetStatus('The AIRIZ is back on USB. Still sharing with code ' + host.code + '.');
      }
      return;
    }
    if (status.reconnecting) {
      if (!host.usbLostAt) {
        host.usbLostAt = Date.now();
        hostBroadcast({ type: 'rx', data: '\r\n[PC] The AIRIZ USB connection dropped - the PC is reconnecting it.\r\n' }, true);
        hostSetStatus('The AIRIZ USB connection dropped - reconnecting. Sharing stays on with code ' + host.code + '.');
      }
      return;
    }
    if (status.updating) {
      hostPauseForUpdate();
      return;
    }
    hostStop('Sharing stopped because the AIRIZ was disconnected from this PC.');
  }

  // The console restarts to install an update: phones keep trying, and the share comes back
  // with the same code once the AIRIZ is reconnected after the restart.
  function hostPauseForUpdate() {
    if (!host.code) return;
    const code = host.code;
    hostStop(null, true, { restart: true });
    hostSetStatus('Restarting for the update. Sharing comes back with the same code ' + code + ' after the restart.');
  }
  window.addEventListener('airiz:update-restart', hostPauseForUpdate);
  // The update was called off: share again with the same code once the AIRIZ is back.
  window.addEventListener('airiz:update-cancelled', () => {
    const record = session.loadShareResume(SHARE_STORE);
    if (record && record.reason === 'update' && !host.code) host.pendingResume = record;
  });

  // ------------------------------------------------------------------ PC: same code after a reload (1.9.1)
  function hostShareRecord(reason) {
    const approved = [];
    for (const [id, key] of host.sessionApproved) {
      const hash = host.hashes.get(id + ':' + key);
      if (hash) approved.push([id, hash]);
    }
    for (const [id, hash] of host.resumedApprovals) {
      if (!host.sessionApproved.has(id)) approved.push([id, hash]);
    }
    return { code: host.code, reason, approved };
  }

  async function hostPersistShare(reason) {
    const code = host.code;
    if (!code) return;
    for (const [id, key] of host.sessionApproved) {
      if (host.hashes.has(id + ':' + key)) continue;
      try {
        host.hashes.set(id + ':' + key, await session.hashKey(key));
      } catch (ignored) { /* no SHA-256 here: the device asks again after a reload */ }
    }
    if (host.code !== code) return;
    session.saveShareResume(SHARE_STORE, hostShareRecord(reason));
  }

  function navigationType() {
    try {
      const entry = performance.getEntriesByType('navigation')[0];
      return entry ? entry.type : '';
    } catch (ignored) {
      return '';
    }
  }

  // A share that was running when this page reloaded (or restarted for an update) continues
  // with the same code once the AIRIZ is connected again; otherwise the old record is dropped.
  function hostLoadResume() {
    const record = session.loadShareResume(SHARE_STORE);
    if (!record) return;
    if (session.shouldResumeShare(record, { navigation: navigationType() })) host.pendingResume = record;
    else session.clearShareResume(SHARE_STORE);
  }

  function hostTryResume() {
    const record = host.pendingResume;
    if (!record || host.code) return;
    if (!session.shouldResumeShare(record, { navigation: 'reload' })) {
      host.pendingResume = null;
      session.clearShareResume(SHARE_STORE);
      return;
    }
    const status = api.getStatus();
    if (!status.connected || status.updating || isRemoteTransport(status)) return;
    host.pendingResume = null;
    if (!host.dialog) hostBuildDialog();
    hostStart(0, { code: record.code, approved: record.approved });
    if (host.code === record.code) {
      toast('Sharing resumed with the same code ' + record.code + '. Devices that were connected come back by themselves.');
    }
  }

  function hostStart(attempt = 0, options) {
    const settings = options || {};
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
    const givenCode = /^\d{6}$/.test(String(settings.code || '')) ? String(settings.code) : null;
    // 1.11.4: the owner's own code (Share control > Your code) instead of a random one.
    const ownCode = session.loadOwnCode(SHARE_STORE);
    const resumeCode = givenCode && !settings.own ? givenCode : null;
    const code = givenCode || ownCode || randomDigits();
    host.code = code;
    host.ownCode = !!ownCode && code === ownCode;
    host.resumed = !!resumeCode;
    host.resumedApprovals = new Map(resumeCode && Array.isArray(settings.approved) ? settings.approved : []);
    host.pendingResume = null;
    host.peerOpened = false;
    host.peerBackoff = 0;
    host.peerGaveUp = false;
    host.usbLostAt = 0;
    host.sessionApproved.clear();
    hostStartPeer(code, attempt);
    hostStartRelay(code);
    host.stopOutput = api.onOutput(hostForwardOutput);
    $('share-control-code').textContent = code;
    $('share-control-code-box').hidden = false;
    $('share-control-link').value = controlLink(code);
    document.dispatchEvent(new CustomEvent('airiz:share-code', { detail: { kind: 'control', code, link: controlLink(code) } }));
    $('share-control-link-row').hidden = false;
    $('share-control-start').disabled = true;
    $('share-control-stop').disabled = false;
    if (resumeCode) {
      hostSetStatus('Sharing again with the same code ' + code + '. Devices that were connected come back by themselves.');
    } else if (host.ownCode) {
      hostSetStatus('Sharing with your own code ' + code + '. On the phone or other PC: open the AIRIZ console and type it '
        + 'into Control by code. Keep this window open while sharing.');
    } else {
      hostSetStatus('On the phone or other PC: open the AIRIZ console and type '
        + code + ' into Control by code (or open the link). Keep this window open while sharing.');
    }
    clearInterval(host.watchTimer);
    host.watchTimer = setInterval(hostWatch, 2000);
    clearInterval(host.tickTimer);
    host.tickTimer = setInterval(hostTick, HOST_TICK_MS);
    hostApplyKeepAwake();
    hostPersistShare('running');
    hostRender();
  }

  function hostStop(note, quiet, options) {
    const settings = options || {};
    if (settings.restart && host.code) {
      // Restarting for an update: keep the code for after the restart; phones keep trying.
      session.saveShareResume(SHARE_STORE, hostShareRecord('update'));
      hostBroadcast({ type: 'ended', reason: 'restart' });
    } else {
      // Tell every device the share ended on purpose, so phones do not try to reconnect.
      // 1.11.4: 'code-changed' = the owner moved to a new code (phones say so, and stop).
      session.clearShareResume(SHARE_STORE);
      if (settings.reason === 'code-changed') hostBroadcast({ type: 'ended', reason: 'code-changed' });
      else hostBroadcast({ type: 'ended', reason: 'stopped' });
    }
    const motorRisk = approvedControllers().some(controller => Date.now() - controller.lastMotorAt < MOTOR_STOP_WINDOW_MS);
    const leaving = [...host.controllers.keys()];
    for (const controller of host.controllers.values()) controller.state = 'ended';
    if (motorRisk) {
      api.stopMotor().then(sent => {
        if (sent) toast('Motor stop sent for safety: a remote device had just moved the motor.');
      });
    }
    if (host.code) document.dispatchEvent(new CustomEvent('airiz:share-code', { detail: { kind: 'control', code: null } }));
    host.code = null;
    host.ownCode = false;
    host.resumed = false;
    host.resumedApprovals = new Map();
    host.sessionApproved.clear();
    host.relayStale.clear();
    host.usbLostAt = 0;
    clearInterval(host.watchTimer);
    clearInterval(host.tickTimer);
    clearTimeout(host.relayRetry);
    clearTimeout(host.peerRetry);
    host.relayRetry = null;
    host.peerRetry = null;
    if (host.stopOutput) host.stopOutput();
    host.stopOutput = null;
    const peer = host.peer;
    const socket = host.relay;
    host.peer = null;
    host.relay = null;
    // A moment for the "ended" messages to leave before the transports close.
    setTimeout(() => {
      for (const cid of leaving) hostDropController(cid, null, { silent: true });
      if (peer) {
        try {
          peer.destroy();
        } catch (ignored) { /* already gone */ }
      }
      if (socket) {
        try {
          socket.close();
        } catch (ignored) { /* closing */ }
      }
    }, 400);
    if ($('share-control-code-box')) {
      $('share-control-code-box').hidden = true;
      $('share-control-link-row').hidden = true;
      $('share-control-link').value = '';
      $('share-control-start').disabled = false;
      $('share-control-stop').disabled = true;
    }
    hostApplyKeepAwake();
    if (!quiet && note) {
      hostSetStatus(note);
      toast(note);
    }
    hostRender();
  }


  // Release tests: what a laptop sleep does to the share (its connections die without a
  // goodbye), then the wake-up recovery. destroyPeer=false keeps the PeerJS object like a
  // short sleep does (only the signalling socket drops).
  async function hostTestSleep(ms, destroyPeer) {
    if (!host.code) return false;
    const code = host.code;
    host.asleep = true;
    clearTimeout(host.relayRetry);
    clearTimeout(host.peerRetry);
    host.relayRetry = null;
    host.peerRetry = null;
    const peer = host.peer;
    if (peer) {
      if (destroyPeer === false) {
        try {
          peer.disconnect();
        } catch (ignored) { /* already disconnected */ }
      } else {
        host.peer = null;
        try {
          peer.destroy();
        } catch (ignored) { /* already gone */ }
      }
    }
    const socket = host.relay;
    if (socket) {
      host.relay = null;
      hostRelayDetached();
      try {
        socket.close();
      } catch (ignored) { /* closing */ }
    }
    await sleep(ms || 0);
    clearTimeout(host.peerRetry);
    clearTimeout(host.relayRetry);
    host.peerRetry = null;
    host.relayRetry = null;
    host.asleep = false;
    if (host.code !== code) return false;
    return hostRecover('test');
  }

  session.onWake(reason => {
    hostRecover(reason);
    phoneRetrySoon();
  });
  session.onSuspend(() => {
    if (host.code) hostBroadcast({ type: 'pc-sleep' }, true);
  });

  // =================================================================== phone: connect by code
  function linkError(reason, text) {
    const error = new Error(text);
    error.reason = reason;
    return error;
  }

  // A byte "link" for AirizBle.VerifiedSerialPort that tunnels the console through the PC.
  function createCodeLink(code, report, options) {
    const settings = options || {};
    const cid = randomId();
    const identity = settings.identity || null;
    const decoder = new TextDecoder();
    const paths = [];
    let active = null;
    let closed = false;
    let failed = false;     // lost after approval: never say "bye" (the PC lets us back in)
    let pcSeen = false;
    let pcVersion = 1;
    let remembered = false;
    let lastError = null;
    let onData = null;
    let onLost = null;
    let settle = null;
    let liveness = null;
    let livenessTimer = null;

    const label = 'Remote control (code ' + code + ')';

    function finish(error) {
      if (!settle) return;
      const done = settle;
      settle = null;
      done(error);
    }

    function stopLiveness() {
      clearInterval(livenessTimer);
      livenessTimer = null;
    }

    function lost(error) {
      if (closed) return;
      lastError = error;
      if (settle) {
        finish(error);
        return;
      }
      failed = true;
      stopLiveness();
      if (onLost) onLost(error);
    }

    // PCs with v2 answer pings: if this one stops answering (asleep, offline), reconnect.
    function startLiveness() {
      if (pcVersion < 2 || livenessTimer) return;
      liveness = session.createLiveness({ timeout: PHONE_SILENT_MS, pingEvery: PHONE_PING_MS });
      livenessTimer = setInterval(() => {
        if (closed || !active) return;
        const verdict = liveness.tick();
        if (verdict === 'ping') active.send({ type: 'ping', cid });
        else if (verdict === 'dead') lost(linkError('pc-silent', 'The PC stopped answering (asleep or offline?).'));
      }, 5000);
    }

    function closeOthers(keep) {
      for (const path of paths) {
        if (path !== keep) path.close();
      }
    }

    function hello(path) {
      const message = { type: 'hello', cid, label: deviceLabel(), v: PROTOCOL_VERSION };
      if (identity) {
        message.device = identity.id;
        message.key = identity.key;
      }
      path.send(message);
    }

    function handle(path, message) {
      if (closed || !message || typeof message !== 'object') return;
      if (path === active && liveness) liveness.heard();
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
        if (Number(message.v) > 1) pcVersion = Number(message.v);
        if (message.state === 'pending' && !active) {
          report('Found the PC. Waiting for its operator to press Allow…');
        } else if (message.state === 'approved') {
          if (!active) {
            active = path;
            remembered = !!message.remembered;
            closeOthers(path);
            report(remembered
              ? 'Allowed (this device is remembered). Checking the AIRIZ through the PC…'
              : 'Allowed. Checking the AIRIZ through the PC…');
            finish(null);
            startLiveness();
          }
        } else if (['denied', 'revoked', 'busy'].includes(message.state)) {
          const text = message.state === 'denied' ? 'The PC operator denied remote control.'
            : message.state === 'revoked' ? 'The PC operator ended your remote control.'
              : 'Another device is controlling the AIRIZ right now.';
          if (!active || active === path) lost(linkError(message.state, text));
        }
        return;
      }
      if (message.type === 'rx' && path === active && onData && typeof message.data === 'string') {
        onData(encoder.encode(message.data));
        return;
      }
      // 1.11.1: the camera position tracked by the console with the cable (ptz.js adopts it).
      if (message.type === 'ptz-state' && path === active) {
        phone.ptzState = { state: message.state, at: Date.now() };
        const ptz = window.AirizPtz;
        if (ptz && typeof ptz.applyHost === 'function') {
          try {
            ptz.applyHost(message.state, phone.ptzState.at);
          } catch (ptzError) {
            console.error(ptzError);
          }
        }
        return;
      }
      if (typeof message.type === 'string' && message.type.startsWith('voice-') && path === active) {
        if (phone.voiceHandler) {
          try {
            phone.voiceHandler(message);
          } catch (voiceError) {
            console.error(voiceError);
          }
        }
        return;
      }
      if (message.type === 'pc-sleep' && path === active) {
        report('The PC is going to sleep. This device reconnects by itself when it wakes up.');
        return;
      }
      if (message.type === 'ended' && (!active || active === path)) {
        if (message.reason === 'stopped') lost(linkError('stopped', 'The PC stopped sharing control.'));
        else if (message.reason === 'code-changed') {
          // 1.11.4: the owner moved to a new code; this device needs the new one (no retrying).
          lost(linkError('code-changed', 'The PC owner changed the code. Ask them for the new code.'));
        } else if (message.reason === 'restart') {
          lost(linkError('restart', 'The PC is restarting for an update - this device reconnects to the same code by itself.'));
        } else lost(linkError('pc-gone', 'The PC left (asleep or offline?).'));
      }
    }

    function pathClosed(path) {
      path.dead = true;
      if (closed) return;
      if (active === path) lost(linkError('lost', 'The connection to the PC was lost.'));
      else checkNoPc();
    }

    function checkNoPc() {
      if (active || pcSeen) return;
      if (paths.length && paths.every(path => path.dead || path.noPc || path.unavailable)) {
        lost(linkError('no-pc', 'No PC is sharing control with code ' + code + '. Check the code on the PC (Share control).'));
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
      get lastError() {
        return lastError;
      },
      get remembered() {
        return remembered;
      },
      // 1.10.0: the PC's protocol version (3 = voice messages) and a way to send them
      get pcVersion() {
        return pcVersion;
      },
      get active() {
        return !!active && !closed && !failed;
      },
      sendVoice(message) {
        if (!active || closed || failed) return false;
        active.send(Object.assign({}, message, { cid }));
        return true;
      },
      // 1.11.1: ask the console with the cable for a camera action (Go home, Set home, ...)
      sendPtz(message) {
        if (!active || closed || failed) return false;
        active.send(Object.assign({}, message, { cid }));
        return true;
      },
      async subscribe(dataCallback, lostCallback) {
        onData = dataCallback;
        onLost = lostCallback;
        report('Looking for the PC with code ' + code + '…');
        const outcome = new Promise(resolve => { settle = resolve; });
        startPeer();
        startRelay();
        const findTimer = setTimeout(() => {
          if (!pcSeen) {
            lastError = linkError('timeout', 'No answer from a PC with code ' + code + '. Check the code and that the PC is still sharing.');
            finish(lastError);
          }
        }, FIND_PC_TIMEOUT_MS);
        const approveTimer = setTimeout(() => {
          lastError = linkError('approval-timeout', 'The PC operator did not allow the connection in time.');
          finish(lastError);
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
        if (active && !failed) active.send({ type: 'bye', cid });
        closed = true;
        stopLiveness();
        if (!lastError) lastError = linkError('cancelled', 'Connection cancelled.');
        finish(lastError);
        for (const path of paths) path.close();
      },
    };
  }

  const phone = { dialog: null, busy: false, cancel: null, retry: null, lastFailure: null, identity: null, link: null, voiceHandler: null, ptzState: null };

  function phoneIdentity() {
    if (!phone.identity) phone.identity = session.loadIdentity();
    return phone.identity;
  }

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
      if (phone.cancel && !phone.retry) phone.cancel();
      dialog.close();
    });
    phone.dialog = dialog;
    return dialog;
  }

  function phoneStatus(text) {
    const status = $('connect-code-status');
    if (status) status.textContent = text;
  }

  function phoneOpen(prefill, autoConnect) {
    const dialog = phone.dialog || phoneBuildDialog();
    if (prefill) $('connect-code-input').value = prefill;
    const busyElsewhere = api.getStatus().connected;
    phoneStatus(busyElsewhere ? 'Disconnect the current device first.' : '');
    if (!dialog.open) dialog.showModal();
    $('connect-code-input').focus();
    // Opened from a share link: the code is already known, so connect right away
    // (the PC operator still has to press Allow).
    if (autoConnect && prefill && !busyElsewhere && !phone.busy) phoneConnect();
  }

  // One connect routine for the dialog, the inline "Control by code" box, the launcher and
  // the automatic reconnect. ui: { status(text), busy(flag) }
  async function connectWithCode(rawCode, ui, options) {
    const settings = options || {};
    if (!settings.auto && phone.retry) {
      // A connect by hand replaces the automatic reconnect.
      phoneStopRetry();
      for (let waited = 0; waited < 40 && phone.busy; waited++) await sleep(100);
    }
    if (phone.busy) return false;
    const code = String(rawCode || '').replace(/\D/g, '');
    if (code.length !== 6) {
      ui.status('Enter the 6-digit code shown on the PC.');
      phone.lastFailure = { reason: 'input', message: 'Enter the 6-digit code shown on the PC.' };
      return false;
    }
    if (api.getStatus().connected) {
      ui.status('Disconnect the current device first.');
      phone.lastFailure = { reason: 'busy-here', message: 'Disconnect the current device first.' };
      return false;
    }
    phone.busy = true;
    ui.busy(true);
    ui.status(settings.auto ? 'Reconnecting to the PC with code ' + code + '…' : 'Connecting… then wait for the PC to press Allow.');
    phone.ptzState = null;
    const link = createCodeLink(code, ui.status, { identity: phoneIdentity() });
    phone.cancel = () => link.close();
    let connected = false;
    const port = new ble.VerifiedSerialPort(link, lostPort => {
      if (phone.link === link) phone.link = null;
      window.dispatchEvent(new CustomEvent('airiz-port-lost', { detail: lostPort }));
      if (connected) phoneLinkLost(code, ui, link.lastError);
    }, VERIFY_TIMEOUT_MS);
    try {
      await api.connectPort(port);
      connected = true;
      phone.link = link;
      phone.lastFailure = null;
      session.savePhoneResume(PHONE_STORE, code);
      ui.status(link.remembered
        ? 'Connected (remembered device). You are controlling the AIRIZ through the PC.'
        : 'Connected. You are controlling the AIRIZ through the PC.');
      if (!settings.auto) toast('Remote control connected (code ' + code + '). Motor, LEDs, commands and macros now go through the PC.');
      return true;
    } catch (error) {
      const failure = link.lastError || error || {};
      phone.lastFailure = {
        reason: failure.reason || 'verify',
        message: (error && error.message) || failure.message || 'Could not connect.',
      };
      if (!settings.auto && phone.lastFailure.reason === 'restart') {
        // The PC restarts for an update while this device waited for Allow: follow it.
        setTimeout(() => phoneLinkLost(code, ui, failure), 0);
      } else if (!settings.auto) {
        ui.status(phone.lastFailure.message);
      }
      return false;
    } finally {
      phone.cancel = null;
      phone.busy = false;
      ui.busy(false);
      refreshInline();
    }
  }

  async function phoneConnect() {
    const connected = await connectWithCode($('connect-code-input').value, {
      status: phoneStatus,
      busy: flag => {
        $('connect-code-go').disabled = flag;
      },
    });
    if (connected) {
      setTimeout(() => {
        if (phone.dialog && phone.dialog.open) phone.dialog.close();
      }, 1200);
    }
  }

  // ------------------------------------------------ phone: reconnect by itself (v1.9.0)
  // The PC slept, its network dropped or this phone lost Wi-Fi: keep trying the same code.
  // The PC lets this device straight back in (allowed earlier in this share, or remembered).
  function retryNote(reason) {
    switch (reason) {
      case 'no-pc':
        return 'No PC is sharing this code right now (it may be asleep).';
      case 'timeout':
        return 'The PC did not answer (it may be asleep).';
      case 'approval-timeout':
        return 'The PC operator did not press Allow yet.';
      case 'pc-silent':
        return 'The PC stopped answering (asleep or offline?).';
      case 'pc-gone':
        return 'The PC left (asleep or offline?).';
      case 'restart':
        return 'The PC is restarting for an update.';
      default:
        return 'The connection to the PC was lost.';
    }
  }

  function phoneSay(ui, text) {
    if (ui && ui.status) ui.status(text);
    if (!ui || ui.status !== inlineStatus) inlineStatus(text);
  }

  function phoneLinkLost(code, ui, error) {
    const reason = (error && error.reason) || 'lost';
    if (!session.canStartRetry(reason)) {
      session.clearPhoneResume(PHONE_STORE);
      phoneSay(ui, (error && error.message) || 'The connection to the PC was lost.');
      // 1.11.4: keep this reason on screen (not the generic "Disconnected" line after it).
      if (inline.card) inline.card.dataset.wasRemote = '';
      if (reason === 'code-changed') toast(error.message);
      return;
    }
    phoneStopRetry();
    session.savePhoneResume(PHONE_STORE, code);
    const retry = { code, ui, attempt: 0, startedAt: Date.now(), timer: null, dueAt: 0 };
    phone.retry = retry;
    toast(retryNote(reason) + ' Reconnecting automatically with code ' + code + '…');
    phoneScheduleRetry(retry, retryNote(reason));
  }

  function phoneRetryUi(retry) {
    return {
      status: text => phoneSay(retry.ui, text),
      busy: flag => {
        if (retry.ui && retry.ui.busy) retry.ui.busy(flag);
      },
    };
  }

  function phoneScheduleRetry(retry, note) {
    if (phone.retry !== retry) return;
    const delay = session.retryDelay(retry.attempt);
    const attempt = retry.attempt + 1;
    retry.dueAt = Date.now() + delay;
    // 1.9.1: no time limit. After the quick attempts it keeps trying once a minute.
    phoneSay(retry.ui, delay >= session.RETRY_SLOW_MS
      ? note + ' Still trying once a minute (attempt ' + attempt + ')…'
      : note + ' Reconnecting automatically (attempt ' + attempt + ')…');
    clearTimeout(retry.timer);
    retry.timer = setTimeout(() => phoneRetryNow(retry), delay);
    refreshInline();
  }

  async function phoneRetryNow(retry) {
    if (phone.retry !== retry) return;
    clearTimeout(retry.timer);
    if (phone.busy) {
      retry.timer = setTimeout(() => phoneRetryNow(retry), 2000);
      return;
    }
    if (api.getStatus().connected) {
      phoneStopRetry();
      return;
    }
    retry.attempt += 1;
    const ok = await connectWithCode(retry.code, phoneRetryUi(retry), { auto: true });
    if (phone.retry !== retry) return;
    if (ok) {
      phone.retry = null;
      toast('Reconnected to the PC (code ' + retry.code + ').');
      phoneSay(retry.ui, 'Reconnected. You are controlling the AIRIZ through the PC.');
      refreshInline();
      return;
    }
    const failure = phone.lastFailure || {};
    if (!session.canContinueRetry(failure.reason)) {
      // The PC said no (stopped sharing, denied, ended this device) or the code is wrong.
      phone.retry = null;
      session.clearPhoneResume(PHONE_STORE);
      phoneSay(retry.ui, failure.message || 'Could not reconnect.');
      refreshInline();
      return;
    }
    phoneScheduleRetry(retry, retryNote(failure.reason));
  }

  // Woke up, back online or back in view: try again now instead of waiting.
  function phoneRetrySoon() {
    const retry = phone.retry;
    if (!retry || phone.busy) return;
    clearTimeout(retry.timer);
    retry.timer = setTimeout(() => phoneRetryNow(retry), 500);
  }

  function phoneStopRetry(note) {
    const retry = phone.retry;
    if (!retry) return false;
    phone.retry = null;
    session.clearPhoneResume(PHONE_STORE);
    clearTimeout(retry.timer);
    if (phone.busy && phone.cancel) phone.cancel();
    if (note) phoneSay(retry.ui, note);
    refreshInline();
    return true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') phoneRetrySoon();
  });

  // ------------------------------------------------ inline "Control by code" box (v1.6.0)
  // Type the 6 digits straight into the console: it connects by itself, no dialog,
  // no Bluetooth. Phones get this box first and Bluetooth is folded away.
  const inline = {
    card: $('remote-code-card'),
    form: $('remote-code-form'),
    input: $('remote-code-inline'),
    go: $('remote-code-go'),
    status: $('remote-code-status'),
    other: $('remote-code-other'),
  };

  function inlineStatus(text) {
    inline.lastText = text; // English source (the language layer translates what is shown)
    if (inline.status) inline.status.textContent = text;
  }

  function inlineBusy(flag) {
    if (inline.go) inline.go.disabled = flag && !phone.retry;
    if (inline.input) inline.input.disabled = flag;
  }

  function inlineConnect() {
    if (!inline.input) return;
    if (phone.retry) {
      phoneStopRetry('Stopped reconnecting. Type the code to connect again.');
      return;
    }
    if (inline.card.classList.contains('is-connected')) {
      const disconnectButton = $('btn-disconnect');
      if (disconnectButton && !disconnectButton.disabled) disconnectButton.click();
      return;
    }
    connectWithCode(inline.input.value, { status: inlineStatus, busy: inlineBusy });
  }

  function refreshInline() {
    if (!inline.card) return;
    const status = api.getStatus();
    // Connected through a PC right now (the port label lingers for a moment after a drop).
    const remote = status.connected && isRemoteTransport(status);
    // The PC that has the AIRIZ on USB does not need this box; it shares instead.
    inline.card.hidden = status.connected && !remote && !status.demoMode;
    inline.card.classList.toggle('is-connected', remote);
    inline.card.classList.toggle('is-reconnecting', !!phone.retry);
    if (inline.go && phone.retry) {
      inline.go.textContent = 'Stop';
      inline.go.disabled = false;
      inline.go.classList.remove('btn-primary');
      inline.go.classList.add('btn-secondary');
    } else if (inline.go && !phone.busy) {
      inline.go.textContent = remote ? 'Disconnect' : 'Connect';
      inline.go.classList.toggle('btn-primary', !remote);
      inline.go.classList.toggle('btn-secondary', remote);
    }
    if (inline.input && !phone.busy) inline.input.disabled = remote;
    if (remote && inline.status && !/^(Connected|Reconnected)/.test(inline.lastText || '')) {
      inlineStatus('Connected. You are controlling the AIRIZ through the PC.');
    }
    if (!status.connected && !phone.retry && !phone.busy && inline.card.dataset.wasRemote === '1') {
      session.clearPhoneResume(PHONE_STORE);
      inlineStatus('Disconnected. Type a new code to connect again.');
    }
    inline.card.dataset.wasRemote = remote ? '1' : '';
  }

  if (inline.form) {
    inline.form.addEventListener('submit', event => {
      event.preventDefault();
      inlineConnect();
    });
    inline.input.addEventListener('input', () => {
      const digits = inline.input.value.replace(/\D/g, '').slice(0, 6);
      if (inline.input.value !== digits) inline.input.value = digits;
      if (digits.length === 6 && !phone.busy && !api.getStatus().connected) {
        if (phone.retry) phoneStopRetry();
        connectWithCode(digits, { status: inlineStatus, busy: inlineBusy });
      } else if (digits.length < 6 && !phone.retry) {
        inlineStatus('');
      }
    });
  }

  const phoneLayout = !document.documentElement.classList.contains('desktop-edition')
    && !window.airizDesktop
    && (window.matchMedia('(max-width: 820px)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
  document.documentElement.classList.toggle('phone-layout', phoneLayout);
  if (inline.other) {
    inline.other.addEventListener('click', () => {
      const shown = document.documentElement.classList.toggle('show-other-ways');
      inline.other.textContent = shown ? 'Hide other ways' : 'Other ways (Bluetooth, Windows app)';
      inline.other.setAttribute('aria-expanded', String(shown));
    });
  }

  // =================================================================== buttons and state
  const shareButton = $('btn-share-control');
  const codeButton = $('btn-connect-code');

  if (shareButton) {
    shareButton.addEventListener('click', () => {
      const dialog = host.dialog || hostBuildDialog();
      if (!host.code) hostSetStatus(api.getStatus().connected ? 'Press Start sharing to get a code.' : 'Connect the AIRIZ to this PC first.');
      hostRender();
      hostRenderTrust();
      hostRenderAwake();
      if (!dialog.open) dialog.showModal();
    });
  }
  if (codeButton) {
    codeButton.addEventListener('click', () => phoneOpen(''));
  }

  function refresh() {
    const status = api.getStatus();
    const remote = status.connected && isRemoteTransport(status);
    if (shareButton) shareButton.disabled = !host.code && (!status.connected || remote);
    if (codeButton) codeButton.disabled = status.connected && !remote;
    if (codeButton) {
      const text = codeButton.querySelector('span') || codeButton;
      text.textContent = remote ? 'Remote: connected' : phone.retry ? 'Remote: reconnecting…' : 'Connect by code';
    }
  }
  setInterval(() => {
    refresh();
    refreshInline();
    hostTryResume();
  }, 1000);
  hostLoadResume();
  refresh();
  refreshInline();
  setInterval(() => {
    if (host.code && host.controllers.size) hostRender();
  }, 15000);

  // Opened from a "Share control" link: index.html#control=123456 (also when the
  // console is already open and only the hash changes).
  function openFromHash() {
    const match = /(?:^|[#&])control=(\d{6})\b/.exec(location.hash || '');
    if (!match) return;
    window.AirizDeepLink = 'control';
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => phoneOpen(match[1], true), 400);
  }
  // 1.9.1: the browser reloaded this page while it controlled a PC (phones reload tabs that
  // slept for a long time): reconnect to the same code by itself. A share link wins.
  function phoneResumeAfterReload() {
    if (/(?:^|[#&])control=\d{6}\b/.test(location.hash || '')) return;
    const saved = session.loadPhoneResume(PHONE_STORE);
    if (!saved || phone.retry || phone.busy || host.code || api.getStatus().connected) return;
    if (inline.input) inline.input.value = saved.code;
    const retry = {
      code: saved.code,
      ui: { status: inlineStatus, busy: inlineBusy },
      attempt: 0,
      startedAt: Date.now(),
      timer: null,
      dueAt: Date.now() + 1000,
    };
    phone.retry = retry;
    phoneSay(retry.ui, 'Reconnecting to the PC with code ' + saved.code + '…');
    retry.timer = setTimeout(() => phoneRetryNow(retry), 1000);
    refreshInline();
  }

  phoneResumeAfterReload();
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  window.AirizRemoteControl = Object.freeze({
    createCodeLink,
    get hostCode() {
      return host.code;
    },
    // quick-connect.js: one button = share (PC) / connect (phone)
    shareStart() {
      if (!host.dialog) hostBuildDialog(); // hostStart fills the dialog's code fields
      hostStart();
      hostRender();
      return host.code;
    },
    shareStop() {
      if (host.code) hostStop('Sharing stopped.');
    },
    openShareDialog() {
      if (shareButton) shareButton.click();
    },
    connectWithCode(code, ui) {
      return connectWithCode(code, ui);
    },
    isRemote() {
      return isRemoteTransport(api.getStatus());
    },
    // v1.9.0: several devices, remembered devices, recovery after sleep.
    get controllers() {
      return [...host.controllers.values()].filter(controller => controller.state !== 'ended').map(controller => ({
        cid: controller.cid,
        label: controller.label,
        state: controller.state,
        remembered: !!controller.remembered,
        trust: controller.trust,
        device: controller.device ? controller.device.id : null,
        paths: [...controller.paths.keys()].map(key => (key.startsWith('p:') ? 'direct' : 'relay')),
      }));
    },
    get rememberedDevices() {
      return trustStore.list();
    },
    get autoAllowRemembered() {
      return trustStore.autoAllow;
    },
    // 1.11.4: Allow remembers the device; the owner's own code.
    get autoRemember() {
      return trustStore.autoRemember;
    },
    get ownCode() {
      return session.loadOwnCode(SHARE_STORE);
    },
    get usingOwnCode() {
      return !!host.ownCode;
    },
    setOwnCode(code) {
      if (!host.dialog) hostBuildDialog();
      return hostSetOwnCode(code);
    },
    useRandomCodes() {
      if (!host.dialog) hostBuildDialog();
      hostUseRandomCodes();
    },
    get pendingRequests() {
      return pendingControllers().map(controller => controller.label);
    },
    get reconnecting() {
      return !!phone.retry;
    },
    get keepAwake() {
      return { wanted: keepAwake.wanted, active: keepAwake.active, mode: keepAwake.mode };
    },
    // 1.9.1
    get power() {
      return host.power;
    },
    get shareResume() {
      return session.loadShareResume(SHARE_STORE);
    },
    get resumedShare() {
      return host.resumed;
    },
    get phoneResume() {
      return session.loadPhoneResume(PHONE_STORE);
    },
    recover(reason) {
      const recovered = hostRecover(reason || 'manual');
      phoneRetrySoon();
      return recovered;
    },
    stopReconnecting() {
      return phoneStopRetry('Stopped reconnecting. Type the code to connect again.');
    },
    testSleep(ms, options) {
      return hostTestSleep(ms, !(options && options.destroyPeer === false));
    },
    // 1.10.0 voice link (audio-ui.js): this phone's link to the PC
    get voicePeer() {
      const link = phone.link;
      const status = api.getStatus();
      if (!link || !link.active || !status.connected || !isRemoteTransport(status)) return null;
      return { pcVersion: link.pcVersion };
    },
    sendVoice(message) {
      const link = phone.link;
      return !!(link && link.active && link.sendVoice(message));
    },
    setVoiceHandler(handler) {
      phone.voiceHandler = typeof handler === 'function' ? handler : null;
    },
    // 1.11.1 shared camera (ptz.js): the link to the console with the cable, its latest camera
    // state and a way to ask it for Go home / Set home / soft limits / the rising switch.
    get ptzPeer() {
      const link = phone.link;
      const status = api.getStatus();
      if (!link || !link.active || !status.connected || !isRemoteTransport(status)) return null;
      return { pcVersion: link.pcVersion };
    },
    get ptzState() {
      return phone.ptzState;
    },
    sendPtzAction(action, args) {
      const link = phone.link;
      return !!(link && link.active && link.sendPtz({ type: 'ptz-action', action: String(action || ''), args: args || {} }));
    },
  });
})();
