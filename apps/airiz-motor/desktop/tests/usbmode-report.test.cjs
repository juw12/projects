'use strict';
// USB mode result report (1.11.28) and its on/off switch (1.11.29): which lines are watched, how the
// result is decided, what is sent, and that nothing is watched or sent while the switch is off.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const WEB = path.join(__dirname, '..', '..', 'web');
const report = require(path.join(WEB, 'usbmode-report.js'));

function watchFor(line) {
  return report.createWatch(report.parseCommand(line), line);
}

test('only the three USB mode commands are watched', () => {
  assert.deepEqual(report.parseCommand('diag usbmode set to eth'), { mode: 'eth', to: true });
  assert.deepEqual(report.parseCommand('  diag usbmode set to cdc \r'), { mode: 'cdc', to: true });
  assert.deepEqual(report.parseCommand('diag usbmode set uvc'), { mode: 'uvc', to: false });
  assert.deepEqual(report.parseCommand('diag usbmode set eth'), { mode: 'eth', to: false });
  for (const line of ['diag usbmode get', 'diag usbmode set to hid', 'diag motor pan 20', 'echo diag usbmode set to eth', '']) {
    assert.equal(report.parseCommand(line), null, line);
  }
});

test('the commands on the cards are the ones that are watched', () => {
  const commands = fs.readFileSync(path.join(WEB, 'data', 'commands.js'), 'utf8');
  for (const line of ['diag usbmode set to eth', 'diag usbmode set to cdc', 'diag usbmode set uvc']) {
    assert.ok(commands.includes(`'${line}'`) || commands.includes(`"${line}"`), line + ' is a command card');
    assert.ok(report.parseCommand(line), line + ' is watched');
  }
});

test('lost by itself after the command = dropped, with the seconds it took', () => {
  const watch = watchFor('diag usbmode set to eth');
  report.noteOutput(watch, 'diag usbmode set to eth\r\n');
  report.noteStatus(watch, { connected: true, reconnecting: false }, 1000);
  report.noteLost(watch, 2400);
  report.noteStatus(watch, { connected: false, reconnecting: true }, 3000);
  report.noteOutput(watch, 'boot log: error 5'); // text after the drop is not the answer
  assert.deepEqual(report.resultOf(watch), {
    v: 1, mode: 'eth', to: true, link: 'dropped', dropS: 2, back: false, reply: 'none',
  });
});

test('a device that comes back in the same mode is dropped + back', () => {
  const watch = watchFor('diag usbmode set to cdc');
  report.noteOutput(watch, 'diag usbmode set to cdc\r\nrebooting...\r\n');
  report.noteStatus(watch, { connected: false, reconnecting: true }, 1000);
  report.noteStatus(watch, { connected: true, reconnecting: false }, 21000);
  const result = report.resultOf(watch);
  assert.equal(result.link, 'dropped');
  assert.equal(result.dropS, 1);
  assert.equal(result.back, true);
  assert.equal(result.reply, 'text');
});

test('still connected with an error text = kept + error; with nothing = kept + none', () => {
  const refused = watchFor('diag usbmode set to eth');
  report.noteOutput(refused, 'diag usbmode set to eth\r\n');
  report.noteOutput(refused, 'Unknown command. usage: diag usbmode set <uvc|cdc|eth>\r\n');
  report.noteStatus(refused, { connected: true, reconnecting: false }, 45000);
  assert.deepEqual(report.resultOf(refused), {
    v: 1, mode: 'eth', to: true, link: 'kept', dropS: null, back: false, reply: 'error',
  });
  const silent = watchFor('diag usbmode set uvc');
  report.noteOutput(silent, 'diag usbmode set uvc\r\n');
  assert.equal(report.resultOf(silent).reply, 'none');
  assert.equal(report.resultOf(silent).link, 'kept');
});

test('an answer that arrives before the console says "sent" counts from the echo on', () => {
  const line = 'diag usbmode set uvc';
  assert.equal(report.earlyAnswer('old error text\r\n~ # ' + line + "\r\ndiag: unknown command 'usbmode'\r\n", line),
    line + "\r\ndiag: unknown command 'usbmode'\r\n");
  assert.equal(report.earlyAnswer('error: something earlier\r\n~ # ', line), '', 'no echo: earlier text is not the answer');
  const watch = watchFor(line);
  report.noteOutput(watch, report.earlyAnswer('~ # ' + line + '\r\nusage: diag usbmode set <mode>\r\n', line));
  assert.equal(report.resultOf(watch).reply, 'error');
});

test('Disconnect (no loss detected) is closed, not dropped', () => {
  const watch = watchFor('diag usbmode set to eth');
  report.noteStatus(watch, { connected: false, reconnecting: false }, 8000);
  const result = report.resultOf(watch);
  assert.equal(result.link, 'closed');
  assert.equal(result.dropS, 8);
});

test('the result holds no device text and no identity', () => {
  const watch = watchFor('diag usbmode set to eth');
  report.noteOutput(watch, 'SN 123456 user juwen error\r\n');
  const result = report.resultOf(watch);
  assert.deepEqual(Object.keys(result).sort(), ['back', 'dropS', 'link', 'mode', 'reply', 'to', 'v']);
  assert.ok(!JSON.stringify(result).includes('123456'));
});

test('a phone that controls another PC by code does not report; Bluetooth and USB do', () => {
  assert.equal(report.transportOf({ transportLabel: 'Remote control (code 123456)' }), 'remote');
  assert.equal(report.transportOf({ transportLabel: 'Bluetooth (AIRIZ bridge)' }), 'bluetooth');
  assert.equal(report.transportOf({ transportLabel: 'USB serial' }), 'usb');
});

test('reports only leave from the published console, and can be switched off', () => {
  const page = (origin, setting) => ({
    location: { origin },
    localStorage: { getItem: () => setting },
  });
  for (const origin of ['https://juw12.github.io', 'airiz://app', 'https://localhost', 'capacitor://localhost']) {
    assert.equal(report.reportingAllowed(page(origin, null)), true, origin);
  }
  assert.equal(report.reportingAllowed(page('https://console.example.com', null)), false);
  assert.equal(report.reportingAllowed(page('http://localhost:8080', null)), false);
  assert.equal(report.reportingAllowed(page('airiz://app', 'off')), false);
});

test('a copy on another site reports to its own web server only when its page asks for it', async () => {
  const copy = (content, setting) => ({
    location: { origin: 'https://console.example.com', protocol: 'https:', href: 'https://console.example.com/' },
    localStorage: { getItem: () => setting },
    document: { querySelector: () => (content === null ? null : { getAttribute: () => content }) },
  });
  assert.equal(report.reportSink(copy(null, null)), null);
  assert.equal(report.reportSink(copy('relay', null)), null);
  assert.equal(report.reportSink(copy('same-origin', null)), 'same-origin');
  assert.equal(report.reportSink(copy('same-origin', 'off')), null, 'switched off on this device');
  assert.equal(report.reportSink({ location: { origin: 'airiz://app' }, localStorage: { getItem: () => null } }), 'relay');

  const stored = {
    v: 1, mode: 'eth', to: true, link: 'dropped', dropS: 2, back: false, reply: 'text',
    app: report.APP_VERSION, edition: 'web', transport: 'usb', rid: 'aaaaaaaaaaaa', at: Date.now() - 3000,
  };
  const url = new URL(report.sameOriginUrl(stored, 'https://console.example.com/'));
  assert.equal(url.origin + url.pathname, 'https://console.example.com/usbmode-report.js');
  assert.deepEqual([...url.searchParams.keys()].sort(),
    ['agoS', 'app', 'back', 'dropS', 'edition', 'link', 'mode', 'reply', 'report', 'rid', 'to', 'transport', 'v']);
  assert.equal(url.searchParams.get('mode'), 'eth');
  assert.equal(url.searchParams.get('link'), 'dropped');
  assert.equal(url.searchParams.get('to'), '1');

  const outcome = fetchImpl => new Promise(resolve => {
    const root = Object.assign(copy('same-origin', null), { fetch: fetchImpl });
    report.sendSameOrigin(stored, root, resolve, 200);
  });
  const calls = [];
  assert.equal(await outcome((address, options) => {
    calls.push({ address, options });
    return Promise.resolve({ status: 200 });
  }), 'sent');
  assert.equal(calls[0].options.method, 'HEAD');
  assert.equal(calls[0].options.credentials, 'same-origin', 'the sign-in of that site goes along');
  assert.equal(new URL(calls[0].address).origin, 'https://console.example.com', 'never another site');
  assert.equal(await outcome(() => Promise.resolve({ status: 502 })), 'retry');
  assert.equal(await outcome(() => Promise.resolve({ status: 200, redirected: true })), 'retry', 'sent to a sign-in page');
  assert.equal(await outcome(() => Promise.reject(new Error('offline'))), 'retry');
  assert.equal(await outcome(() => new Promise(() => {})), 'retry', 'no answer in time');
});

function fakeSocket(script) {
  const sent = [];
  class Socket {
    constructor(url) {
      this.url = url;
      Socket.last = this;
      setImmediate(() => script(this, sent));
    }
    send(text) { sent.push(text); }
    close() { this.closed = true; }
  }
  Socket.sent = sent;
  return Socket;
}

test('a stored report is "sent"; a refused one is not retried; no answer is retried later', async () => {
  const stored = { v: 1, mode: 'eth', at: Date.now() - 5000, rid: 'aaaaaaaaaaaa' };
  const outcome = script => new Promise(resolve => {
    const Socket = fakeSocket(script);
    report.sendReport(stored, Socket, result => resolve({ result, Socket }), 200);
  });
  const ok = await outcome(socket => {
    socket.onopen();
    socket.onmessage({ data: '{"ok":true}' });
  });
  assert.equal(ok.result, 'sent');
  assert.equal(ok.Socket.last.url, 'wss://airiz-relay.juw12.workers.dev/v1/report');
  const body = JSON.parse(ok.Socket.sent[0]);
  assert.equal(body.at, undefined, 'the clock time stays on the device');
  assert.ok(body.agoS >= 5 && body.agoS <= 7, 'age in seconds is sent instead');
  assert.equal((await outcome(socket => {
    socket.onopen();
    socket.onmessage({ data: '{"ok":false}' });
  })).result, 'rejected');
  assert.equal((await outcome(socket => socket.onerror())).result, 'retry');
  assert.equal((await outcome(() => {})).result, 'retry', 'no answer in time');
});

// ---------------------------------------------------------------- 1.11.29: the switch under the console
function fakeStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

test('the switch is stored on the device, and turning it off deletes results that were waiting', () => {
  const storage = fakeStorage({ 'airiz.usbmodeReports': '[{"v":1}]' });
  assert.equal(report.reportsOff(storage), false, 'on until somebody turns it off');
  assert.equal(report.setReportsOff(storage, true), true);
  assert.equal(storage.getItem('airiz.usageReports'), 'off');
  assert.equal(storage.getItem('airiz.usbmodeReports'), null, 'nothing is sent later');
  assert.equal(report.setReportsOff(storage, false), false);
  assert.equal(storage.getItem('airiz.usageReports'), null);
  const blocked = { getItem() { throw new Error('blocked'); } };
  assert.equal(report.reportsOff(blocked), true, 'no storage = no reports');
});

// A page with the console API, the switch and a relay that never answers.
function fakePage(origin, stored) {
  const listeners = {};
  const handlers = { sent: [], output: [] };
  const option = { hidden: true };
  const checkbox = {
    checked: false,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    set(value) {
      this.checked = value;
      this.listeners.change();
    },
  };
  const sockets = [];
  const root = {
    location: { origin, protocol: 'https:', href: origin + '/' },
    localStorage: fakeStorage(stored),
    crypto: { getRandomValues: bytes => bytes.fill(7) },
    WebSocket: class {
      constructor(url) { sockets.push(url); }
      close() {}
    },
    document: {
      querySelector: () => null,
      getElementById: id => ({ 'usbmode-report-option': option, 'chk-usbmode-report': checkbox }[id] || null),
    },
    addEventListener: (name, handler) => { listeners[name] = handler; },
    AirizConsole: {
      onCommandSent: handler => handlers.sent.push(handler),
      onOutput: handler => handlers.output.push(handler),
      getStatus: () => ({ connected: true, demoMode: false, transportLabel: 'USB serial' }),
    },
  };
  return {
    root, option, checkbox, sockets,
    send: line => handlers.sent.forEach(handler => handler(line)),
    closePage: () => listeners.pagehide(),
    queue: () => JSON.parse(root.localStorage.getItem('airiz.usbmodeReports') || '[]'),
  };
}

test('the switch is shown where the console reports; off = no watch, on again works without a restart', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const page = fakePage('airiz://app', {});
  assert.equal(report.start(page.root), true);
  assert.equal(page.option.hidden, false, 'the switch is visible');
  assert.equal(page.checkbox.checked, true, 'ticked: reporting is on');

  page.send('diag usbmode set to eth');
  page.closePage(); // ends the watch at once
  assert.equal(page.queue().length, 1, 'one result waits for the relay');
  assert.equal(page.queue()[0].mode, 'eth');
  assert.equal(page.queue()[0].app, report.APP_VERSION);
  assert.equal(page.sockets.length, 1, 'and is offered to the relay');

  page.checkbox.set(false);
  assert.equal(page.root.localStorage.getItem('airiz.usageReports'), 'off');
  assert.equal(page.queue().length, 0, 'the waiting result is deleted');
  page.send('diag usbmode set to cdc');
  page.closePage();
  assert.equal(page.queue().length, 0, 'off: the command is not watched');
  assert.equal(page.sockets.length, 1, 'off: nothing goes to the relay');

  page.send('diag usbmode set to eth');
  page.checkbox.set(true); // turned on in the middle: that command was not watched
  page.closePage();
  assert.equal(page.queue().length, 0);
  page.send('diag usbmode set to cdc');
  page.closePage();
  assert.equal(page.queue().length, 1, 'on again: watched without a restart');
  assert.equal(page.queue()[0].mode, 'cdc');
});

test('a watch that runs when the switch is turned off is thrown away', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const page = fakePage('airiz://app', {});
  report.start(page.root);
  page.send('diag usbmode set to eth');
  page.checkbox.set(false);
  page.closePage();
  assert.equal(page.queue().length, 0);
  assert.equal(page.sockets.length, 0);
});

test('a device where it was turned off starts with the switch unticked; other sites get no switch', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const off = fakePage('https://juw12.github.io', { 'airiz.usageReports': 'off' });
  assert.equal(report.start(off.root), true);
  assert.equal(off.option.hidden, false);
  assert.equal(off.checkbox.checked, false);
  off.send('diag usbmode set to eth');
  off.closePage();
  assert.equal(off.queue().length, 0);

  const elsewhere = fakePage('https://console.example.com', {});
  assert.equal(report.start(elsewhere.root), false, 'this copy never reports');
  assert.equal(elsewhere.option.hidden, true, 'so it shows no switch');
});

test('the page has the switch, hidden until the module shows it', () => {
  const index = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(index, /<label class="checkbox-label" hidden="" id="usbmode-report-option"[^>]*>\s*<input checked="" id="chk-usbmode-report" type="checkbox"\/>\s*Send USB mode result\s*<\/label>/);
});

test('the version in the report is the app version, and the page loads and caches the module', () => {
  const version = require(path.join(__dirname, '..', 'package.json')).version;
  assert.equal(report.APP_VERSION, version);
  const index = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.ok(index.indexOf('<script src="usbmode-report.js"></script>') > index.indexOf('<script src="app.js"></script>'));
  assert.ok(fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8').includes("'./usbmode-report.js'"));
});
