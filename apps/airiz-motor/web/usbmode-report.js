/* AIRIZ USB mode result report (1.11.28; on/off switch 1.11.29).
 *
 * The USB mode commands (diag usbmode set to eth / set to cdc / set uvc) could not be tried on a
 * real AIRIZ by the owner. So that he does not have to ask every user, the console watches what
 * happens after one of these three commands is sent to a real device and reports the result once:
 *
 *   mode       cdc | eth | uvc
 *   to         true when the line had the word "to" (set to eth), false for "set uvc"
 *   link       dropped  the device connection was lost by itself (it rebooted / changed USB mode)
 *              closed   the connection ended without a loss being detected (Disconnect, Bluetooth)
 *              kept     still connected at the end of the watch
 *   dropS      seconds from the command to the end of the connection (null when kept)
 *   back       true when the same connection came back during the watch
 *   reply      none | text | error   (error: the device printed words such as "unknown" or "usage:")
 *   app        version of this console, edition (web / desktop / mobile), transport (usb / bluetooth)
 *   rid        a random number for this one report (so it is stored once when it is sent again)
 *
 * Nothing else is sent: no device text, no serial number, no user or PC name, no other command.
 * The relay worker (apps/airiz-motor/relay) stores these rows without the sender's address and
 * shows them at https://airiz-relay.juw12.workers.dev/v1/reports/usbmode
 *
 * Not reported: demo mode, a phone that controls another PC by code (that PC reports), and copies
 * of the console on other sites. To turn it off on one device: untick "Send USB mode result" under
 * the console (1.11.29). That stores localStorage 'airiz.usageReports' = 'off', stops a watch that
 * is running and deletes results that were still waiting to be sent.
 *
 * A copy on another site (for example a company app portal) can keep the result on that site: its
 * index.html adds <meta name="airiz-usage-report" content="same-origin">. The same result is then
 * sent as one HEAD request for this file, with the result in the query, to that site's own web
 * server (with that site's sign-in), which writes it to its access log. Nothing goes to the relay
 * from such a copy.
 *
 * No DOM access in the functions that decide the result: they also run in the Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AirizUsbModeReport = api;
  if (root && root.document) api.start(root);
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const APP_VERSION = '1.11.29';
  const REPORT_URL = 'wss://airiz-relay.juw12.workers.dev/v1/report';
  // The same origins the relay accepts; other hosts (other sites, localhost tests) do not use the relay.
  const REPORT_ORIGINS = ['https://juw12.github.io', 'airiz://app', 'capacitor://localhost', 'https://localhost'];
  const WATCH_MS = 45000;
  const TICK_MS = 1000;
  const SEND_TIMEOUT_MS = 15000;
  const QUEUE_KEY = 'airiz.usbmodeReports';
  const OPT_OUT_KEY = 'airiz.usageReports';
  const MAX_QUEUE = 20;
  const MAX_REPLY_CHARS = 4000;
  const EARLY_ANSWER_MS = 300;
  const MAX_EARLY_CHARS = 600;
  const COMMAND = /^\s*diag\s+usbmode\s+set\s+(to\s+)?(cdc|eth|uvc)\s*$/i;
  const ERROR_TEXT = /unknown|invalid|not\s+found|unsupported|not\s+support|usage\s*:|no\s+such|bad\s+(arg|param|command)|\berror\b|\bfail(ed|ure)?\b/i;

  function parseCommand(line) {
    const match = COMMAND.exec(String(line || ''));
    if (!match) return null;
    return { mode: match[2].toLowerCase(), to: !!match[1] };
  }

  function transportOf(status) {
    const label = String((status && status.transportLabel) || '');
    if (/^Remote/i.test(label)) return 'remote';
    return /bluetooth/i.test(label) ? 'bluetooth' : 'usb';
  }

  // ------------------------------------------------------------------ one watch
  function createWatch(command, line) {
    return {
      mode: command.mode,
      to: command.to,
      line: String(line || '').trim(),
      text: '',
      downAtMs: null,
      lost: false,
      back: false,
    };
  }

  // Device text is only kept in memory to tell "nothing / something / an error"; it is never sent.
  function noteOutput(watch, text) {
    if (watch.downAtMs !== null) return;
    if (watch.text.length < MAX_REPLY_CHARS) watch.text += String(text || '');
  }

  // A fast device can answer before the console says "sent": text that arrived just before the
  // watch started counts from the echo of this command on (nothing when the echo is not in it).
  function earlyAnswer(recentText, line) {
    const echoAt = line ? String(recentText || '').lastIndexOf(line) : -1;
    return echoAt === -1 ? '' : recentText.slice(echoAt);
  }

  function noteLost(watch, elapsedMs) {
    if (watch.downAtMs === null) watch.downAtMs = elapsedMs;
    watch.lost = true;
  }

  function noteStatus(watch, status, elapsedMs) {
    if (!status) return;
    if (!status.connected) {
      if (watch.downAtMs === null) watch.downAtMs = elapsedMs;
      if (status.reconnecting) watch.lost = true;
    } else if (watch.downAtMs !== null) {
      watch.back = true;
    }
  }

  function replyOf(watch) {
    // The device echoes the typed line: that is not an answer.
    const answer = watch.text.split(watch.line).join('');
    if (!/\S/.test(answer)) return 'none';
    return ERROR_TEXT.test(answer) ? 'error' : 'text';
  }

  function resultOf(watch) {
    const down = watch.downAtMs !== null;
    return {
      v: 1,
      mode: watch.mode,
      to: watch.to,
      link: !down ? 'kept' : (watch.lost ? 'dropped' : 'closed'),
      dropS: down ? Math.max(0, Math.round(watch.downAtMs / 1000)) : null,
      back: down && watch.back,
      reply: replyOf(watch),
    };
  }

  // ------------------------------------------------------------------ queue + sending
  function readQueue(storage) {
    try {
      const list = JSON.parse(storage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function writeQueue(storage, list) {
    try {
      if (list.length) storage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-MAX_QUEUE)));
      else storage.removeItem(QUEUE_KEY);
    } catch (error) { /* storage full or blocked: the report is lost, nothing else breaks */ }
  }

  // done('sent') stored, done('rejected') the relay refused it (do not retry), done('retry') no answer.
  function sendReport(report, WebSocketImpl, done, timeoutMs) {
    let settled = false;
    let socket = null;
    let timer = null;
    function finish(outcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (socket) socket.close();
      } catch (ignored) { /* already closed */ }
      done(outcome);
    }
    timer = setTimeout(() => finish('retry'), timeoutMs || SEND_TIMEOUT_MS);
    try {
      socket = new WebSocketImpl(REPORT_URL);
    } catch (error) {
      finish('retry');
      return;
    }
    socket.onopen = () => {
      const body = Object.assign({}, report, { agoS: Math.max(0, Math.round((Date.now() - report.at) / 1000)) });
      delete body.at;
      try {
        socket.send(JSON.stringify(body));
      } catch (error) {
        finish('retry');
      }
    };
    socket.onmessage = event => {
      let answer = null;
      try {
        answer = JSON.parse(String(event.data));
      } catch (ignored) { /* not JSON */ }
      finish(answer && answer.ok === true ? 'sent' : 'rejected');
    };
    socket.onerror = () => finish('retry');
    socket.onclose = () => finish('retry');
  }

  // Names one report (so the relay stores it once when it is sent again), not a user or device.
  function reportId(root) {
    const bytes = new Uint8Array(6);
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }

  // The same result as one request to the site this copy is served from (see the note at the top).
  function sameOriginUrl(report, pageUrl) {
    const query = new URLSearchParams({
      report: 'usbmode',
      v: String(report.v),
      mode: String(report.mode),
      to: report.to ? '1' : '0',
      link: String(report.link),
      dropS: report.dropS === null || report.dropS === undefined ? '' : String(report.dropS),
      back: report.back ? '1' : '0',
      reply: String(report.reply),
      app: String(report.app),
      edition: String(report.edition),
      transport: String(report.transport),
      rid: String(report.rid),
      agoS: String(Math.max(0, Math.round((Date.now() - report.at) / 1000))),
    });
    return new URL('usbmode-report.js?' + query.toString(), pageUrl).href;
  }

  function sendSameOrigin(report, root, done, timeoutMs) {
    let settled = false;
    function finish(outcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(outcome);
    }
    const timer = setTimeout(() => finish('retry'), timeoutMs || SEND_TIMEOUT_MS);
    try {
      // The page's own sign-in goes along (a portal behind single sign-on answers a request
      // without it with its sign-in page, and the result never reaches the access log).
      root.fetch(sameOriginUrl(report, root.location.href), { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
        .then(response => finish(response.status < 500 && !response.redirected ? 'sent' : 'retry'), () => finish('retry'));
    } catch (error) {
      finish('retry');
    }
  }

  // The switch under the console ("Send USB mode result"): off = nothing is watched or sent.
  function reportsOff(storage) {
    try {
      return storage.getItem(OPT_OUT_KEY) === 'off';
    } catch (error) {
      return true; // storage blocked: nothing can be kept or sent anyway
    }
  }

  // Turning it off also deletes the results that were still waiting to be sent.
  function setReportsOff(storage, off) {
    try {
      if (off) {
        storage.setItem(OPT_OUT_KEY, 'off');
        storage.removeItem(QUEUE_KEY);
      } else {
        storage.removeItem(OPT_OUT_KEY);
      }
    } catch (error) { /* storage blocked */ }
    return reportsOff(storage);
  }

  // Where this copy sends results when the switch is on: 'relay' for the published console,
  // 'same-origin' for a copy that asks for it, null: this copy never reports.
  function sinkOf(root) {
    try {
      if (REPORT_ORIGINS.includes(root.location.origin)) return 'relay';
      const meta = root.document && root.document.querySelector('meta[name="airiz-usage-report"]');
      if (meta && meta.getAttribute('content') === 'same-origin' && /^https?:$/.test(root.location.protocol)) return 'same-origin';
    } catch (error) { /* DOM blocked: no reports */ }
    return null;
  }

  function reportSink(root) {
    try {
      return reportsOff(root.localStorage) ? null : sinkOf(root);
    } catch (error) {
      return null;
    }
  }

  function reportingAllowed(root) {
    return reportSink(root) !== null;
  }

  // ------------------------------------------------------------------ wiring (browser only)
  function start(root) {
    const consoleApi = root.AirizConsole;
    // A copy that never reports gets no listeners and keeps the switch hidden. With the switch
    // off the listeners are still set, so that turning it on works without a restart.
    if (!consoleApi || typeof consoleApi.onCommandSent !== 'function' || !sinkOf(root)) return false;
    const storage = root.localStorage;
    const edition = root.airizDesktop ? 'desktop' : (root.airizMobile ? 'mobile' : 'web');
    let watch = null;
    let watchStartedAt = 0;
    let watchTransport = 'usb';
    let ticker = null;
    let flushing = false;
    let recent = { text: '', at: 0 }; // device text of the last moments, only while no watch runs

    function flush() {
      const sink = reportSink(root);
      if (flushing || !sink) return;
      const queue = readQueue(storage);
      if (!queue.length) return;
      flushing = true;
      const first = queue[0];
      const sent = outcome => {
        flushing = false;
        if (outcome === 'retry') return; // next start, next report or when the network is back
        // By its number: the list may have been emptied by the switch while this one was on its way.
        writeQueue(storage, readQueue(storage).filter(item => item.rid !== first.rid));
        flush();
      };
      if (sink === 'relay') sendReport(first, root.WebSocket, sent);
      else sendSameOrigin(first, root, sent);
    }

    function dropWatch() {
      clearInterval(ticker);
      watch = null;
    }

    function finishWatch() {
      if (!watch) return;
      if (reportsOff(storage)) {
        dropWatch();
        return;
      }
      clearInterval(ticker);
      const report = Object.assign(resultOf(watch), {
        rid: reportId(root),
        app: APP_VERSION,
        edition,
        transport: watchTransport,
        at: watchStartedAt,
      });
      watch = null;
      const queue = readQueue(storage);
      queue.push(report);
      writeQueue(storage, queue);
      flush();
    }

    function tick() {
      if (!watch) return;
      const elapsed = Date.now() - watchStartedAt;
      noteStatus(watch, consoleApi.getStatus(), elapsed);
      if (elapsed >= WATCH_MS) finishWatch();
    }

    consoleApi.onCommandSent(line => {
      const command = parseCommand(line);
      if (!command || reportsOff(storage)) return;
      const status = consoleApi.getStatus();
      const transport = transportOf(status);
      if (!status.connected || status.demoMode || transport === 'remote') return;
      finishWatch(); // a second USB mode command ends the watch of the first
      watch = createWatch(command, line);
      watchStartedAt = Date.now();
      if (watchStartedAt - recent.at < EARLY_ANSWER_MS) noteOutput(watch, earlyAnswer(recent.text, watch.line));
      recent = { text: '', at: 0 };
      watchTransport = transport;
      ticker = setInterval(tick, TICK_MS);
    });
    consoleApi.onOutput(text => {
      if (watch) {
        noteOutput(watch, text);
        return;
      }
      const now = Date.now();
      const kept = now - recent.at < EARLY_ANSWER_MS ? recent.text.slice(-MAX_EARLY_CHARS) : '';
      recent = { text: kept + String(text || ''), at: now };
    });
    root.addEventListener('airiz:device-lost', () => {
      if (watch) noteLost(watch, Date.now() - watchStartedAt);
    });
    // Closing the app during the watch: keep what is known so far and send it at the next start.
    root.addEventListener('pagehide', finishWatch);
    root.addEventListener('online', flush);
    setTimeout(flush, 5000);

    // The switch: shown only in a copy that reports, ticked while reporting is on.
    const option = root.document.getElementById('usbmode-report-option');
    const checkbox = root.document.getElementById('chk-usbmode-report');
    if (option && checkbox) {
      checkbox.checked = !reportsOff(storage);
      option.hidden = false;
      checkbox.addEventListener('change', () => {
        const off = setReportsOff(storage, !checkbox.checked);
        checkbox.checked = !off;
        if (off) dropWatch();
        else flush();
      });
    }
    return true;
  }

  return {
    APP_VERSION,
    REPORT_URL,
    REPORT_ORIGINS,
    WATCH_MS,
    parseCommand,
    transportOf,
    createWatch,
    noteOutput,
    earlyAnswer,
    noteLost,
    noteStatus,
    resultOf,
    sendReport,
    sameOriginUrl,
    sendSameOrigin,
    reportsOff,
    setReportsOff,
    sinkOf,
    reportSink,
    reportingAllowed,
    start,
  };
});
