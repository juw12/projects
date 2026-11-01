/* AIRIZ Bluetooth protocol, shared by the web console (Web Bluetooth: Bluefy on
 * iPhone, Chrome/Edge on Android and PCs) and the Capacitor phone app.
 *
 * A "link" is a byte pipe ({label, subscribe(onData, onLost), write(bytes), close()}).
 * VerifiedSerialPort turns it into a Web-Serial-like port. Motor controls stay
 * locked until the device answers the firmware-version query with a framed reply.
 * If the AIRIZ Bluetooth bridge asks for a PIN (#AUTH#required#END#), the PIN is
 * requested and checked before the port opens.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AirizBle = api;
}(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  const FIRMWARE_QUERY = 'diag ver sw\r\n';
  const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
  const BASE = '-0000-1000-8000-00805f9b34fb';
  const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const HM10_SERVICE = '0000ffe0' + BASE;
  const MOTOR_STOP_USB = 'echo 0 > /sys/devices/platform/soc/soc:motor/status';
  const MOTOR_STOP_BRIDGE = 'stop';

  function normalizeUuid(value) {
    const text = String(value).toLowerCase();
    if (/^[a-f0-9]{4}$/.test(text)) return '0000' + text + BASE;
    if (/^[a-f0-9]{8}$/.test(text)) return text + BASE;
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(text)) throw new Error('Invalid Bluetooth UUID');
    return text;
  }

  const UART_PROFILES = [
    { name: 'Nordic UART', service: NUS_SERVICE, write: NUS_WRITE, notify: NUS_NOTIFY },
    { name: 'HM-10-style UART', service: HM10_SERVICE, write: '0000ffe1' + BASE, notify: '0000ffe1' + BASE }
  ];

  function discoverProfiles(services) {
    const found = [];
    for (const profile of UART_PROFILES) {
      const service = services.find(item => normalizeUuid(item.uuid) === profile.service);
      if (!service) continue;
      const write = service.characteristics.find(item => normalizeUuid(item.uuid) === profile.write);
      const notify = service.characteristics.find(item => normalizeUuid(item.uuid) === profile.notify);
      if (write && notify && (write.properties.write || write.properties.writeWithoutResponse)
          && (notify.properties.notify || notify.properties.indicate)) {
        found.push(Object.assign({}, profile, { withoutResponse: !write.properties.write }));
      }
    }
    return found;
  }

  function customProfile(services, serviceId, writeId, notifyId) {
    serviceId = normalizeUuid(serviceId);
    writeId = normalizeUuid(writeId);
    notifyId = normalizeUuid(notifyId);
    // Never probe standard GATT/DFU services as if they were a command console.
    if (serviceId.endsWith(BASE) || serviceId === '00001530-1212-efde-1523-785feabcd123') {
      throw new Error('Standard/DFU services cannot be used as a custom motor-command channel.');
    }
    const service = services.find(item => normalizeUuid(item.uuid) === serviceId);
    const write = service && service.characteristics.find(item => normalizeUuid(item.uuid) === writeId);
    const notify = service && service.characteristics.find(item => normalizeUuid(item.uuid) === notifyId);
    if (!write || !notify || !(write.properties.write || write.properties.writeWithoutResponse)
        || !(notify.properties.notify || notify.properties.indicate)) {
      throw new Error('Choose writable and notifying characteristics from the same vendor service.');
    }
    return { name: 'User-selected text channel', service: serviceId, write: writeId, notify: notifyId, withoutResponse: !write.properties.write };
  }

  function firmwareVersion(text) {
    for (const match of text.matchAll(/#INFO#([\s\S]{0,512}?)#END#/g)) {
      const block = match[1].trim();
      const direct = /^(?:\d+:)?v?(\d+(?:\.\d+){2,3})$/i.exec(block);
      const labeled = /\b(?:firmware|software|version|sw)\b[^\r\n]{0,30}?\b(\d+(?:\.\d+){2,3})\b/i.exec(block);
      if (direct || labeled) return (direct || labeled)[1];
    }
    return null;
  }

  // Bridge PIN replies: ok, denied, locked <seconds>, required.
  function authReply(text) {
    const match = /#AUTH#(ok|denied|required|locked(?: (\d+))?)#END#/.exec(text);
    if (!match) return null;
    if (match[1].startsWith('locked')) return { state: 'locked', seconds: Number(match[2] || 60) };
    return { state: match[1] };
  }

  // Bridge v3 "who" reply: #WHO#<controller>#ADDR|LABEL|SECONDS|PIN_OK;...#END#
  function parseWho(text) {
    const match = /#WHO#([0-9A-Fa-f:]*)#([^#]*)#END#/.exec(text || '');
    if (!match) return null;
    const clients = match[2].split(';').filter(Boolean).map(entry => {
      const [address, label, seconds, pinOk] = entry.split('|');
      return {
        address: (address || '').toUpperCase(),
        label: label && label !== '-' ? label : '',
        seconds: Number(seconds) || 0,
        pinOk: pinOk === '1',
      };
    }).filter(client => /^[0-9A-F:]{17}$/.test(client.address));
    return { controller: match[1].toUpperCase(), clients };
  }

  function bridgeVersion(text) {
    const match = /#BRIDGE#(\d+)#END#/.exec(text || '');
    return match ? Number(match[1]) : 0;
  }

  // Last known "who is connected" list, used to mark AIRIZ-BT in the PC device picker.
  const WHO_CACHE_KEY = 'airiz.bt.who';
  function rememberWho(info) {
    try {
      if (root && root.localStorage && info && info.controller) {
        root.localStorage.setItem(WHO_CACHE_KEY, JSON.stringify(Object.assign({ at: Date.now() }, info)));
      }
    } catch (ignored) { /* storage unavailable */ }
  }
  function recallWho(maxAgeMs) {
    try {
      const info = JSON.parse(root.localStorage.getItem(WHO_CACHE_KEY) || 'null');
      if (info && Date.now() - info.at <= (maxAgeMs || 10 * 60 * 1000)) return info;
    } catch (ignored) { /* storage unavailable */ }
    return null;
  }

  function describeClient(client) {
    const minutes = Math.round(client.seconds / 60);
    const age = client.seconds < 60 ? 'just now' : minutes < 60 ? minutes + ' min'
      : Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
    return (client.label || 'Unnamed device') + (client.pinOk ? ' (PIN ok)' : ' (no PIN yet)') + ', ' + age;
  }

  function concatBytes(first, second) {
    const joined = new Uint8Array(first.length + second.length);
    joined.set(first, 0);
    joined.set(second, first.length);
    return joined;
  }

  function chunks(bytes, size) {
    size = size === undefined ? 20 : size;
    if (!Number.isInteger(size) || size < 1) throw new Error('Invalid packet size');
    const result = [];
    for (let offset = 0; offset < bytes.length; offset += size) result.push(bytes.slice(offset, offset + size));
    return result;
  }

  class VerifiedSerialPort {
    /**
     * options.askPin({attempt, message}) -> Promise<string|null>   (null = cancelled)
     * options.savedPin, options.rememberPin(pin), options.forgetPin()
     */
    constructor(link, onDisconnect, timeoutMs, options) {
      this.link = link;
      this.transportLabel = link.label;
      this.firmwareVersion = null;
      this.bridge = false;
      this.bridgeVersion = 0;
      this.myAddress = '';
      this.whoInfo = null;     // {controller, clients} from bridge v3
      this.authenticated = false;
      this.opened = false;
      this.closed = false;
      this.timeoutMs = timeoutMs === undefined ? 8000 : timeoutMs;
      this.options = options || {};
      this.onDisconnect = onDisconnect;
      this.buffered = [];
      this.probeText = '';
      this.waiter = null;
      this.decoder = new TextDecoder();
      this._readable = new ReadableStream({ start: controller => { this.readerController = controller; } });
      this._writable = new WritableStream({
        write: async bytes => {
          if (!this.opened || this.closed) throw new Error('Motor-command channel is not verified.');
          await this.link.write(new Uint8Array(bytes));
        }
      });
    }

    get readable() { return this.opened && !this.closed ? this._readable : null; }
    get writable() { return this.opened && !this.closed ? this._writable : null; }
    get stopCommand() { return this.bridge ? MOTOR_STOP_BRIDGE : MOTOR_STOP_USB; }

    receive(value) {
      const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      if (this.closed) return;
      if (this.opened) {
        // Bluetooth delivers 20-byte notifications; pass whole lines to the
        // console (flush on newline or after a short pause).
        this.pending = this.pending ? concatBytes(this.pending, bytes) : bytes;
        clearTimeout(this.flushTimer);
        if (bytes.includes(10)) this.flush();
        else this.flushTimer = setTimeout(() => this.flush(), 60);
        return;
      }
      this.buffered.push(bytes);
      this.probeText = (this.probeText + this.decoder.decode(bytes, { stream: true })).slice(-65536);
      this.checkWaiter();
    }

    flush() {
      clearTimeout(this.flushTimer);
      if (!this.pending || this.closed) return;
      const bytes = this.pending;
      this.pending = null;
      try { this.readerController.enqueue(bytes); } catch (ignored) { /* Reader closed */ }
    }

    checkWaiter() {
      if (!this.waiter) return;
      const result = this.waiter.test(this.probeText);
      if (result) {
        const waiter = this.waiter;
        this.waiter = null;
        clearTimeout(waiter.timer);
        waiter.resolve(result);
      }
    }

    waitFor(test, timeoutMs, timeoutMessage) {
      return new Promise((resolve, reject) => {
        this.waiter = {
          test, resolve, reject,
          timer: setTimeout(() => {
            this.waiter = null;
            reject(new Error(timeoutMessage));
          }, timeoutMs)
        };
        this.checkWaiter();
      });
    }

    async send(text) {
      await this.link.write(new TextEncoder().encode(text));
    }

    async authenticate() {
      const options = this.options;
      let candidate = /^\d{6}$/.test(options.savedPin || '') ? options.savedPin : null;
      let message = 'Enter the 6-digit PIN shown when the Bluetooth remote was started.';
      for (let attempt = 1; attempt <= 5; attempt++) {
        let pin = candidate;
        candidate = null;
        if (!pin) {
          if (typeof options.askPin !== 'function') throw new Error('This AIRIZ Bluetooth remote requires a PIN.');
          pin = await options.askPin({ attempt, message });
          if (this.closed) throw new Error('Connection was closed.');
          if (pin === null || pin === undefined) throw new Error('PIN entry cancelled. Motor controls remain locked.');
          pin = String(pin).trim();
          if (!/^\d{6}$/.test(pin)) {
            message = 'The PIN has exactly 6 digits.';
            continue;
          }
        }
        const mark = this.probeText.length;
        const reply = this.waitFor(text => {
          const result = authReply(text.slice(mark));
          return result && result.state !== 'required' ? result : null;
        }, this.timeoutMs, 'The device did not answer the PIN check.');
        await this.send('auth ' + pin + '\n');
        const result = await reply;
        if (result.state === 'ok') {
          this.authenticated = true;
          if (options.rememberPin) options.rememberPin(pin);
          return;
        }
        if (options.forgetPin) options.forgetPin();
        if (result.state === 'locked') {
          throw new Error('Too many wrong PINs. Wait ' + result.seconds + ' s, then connect again.');
        }
        message = 'Wrong PIN. Try again (check the PIN in the USB console or the Phone remote dialog).';
      }
      throw new Error('PIN not accepted. Motor controls remain locked.');
    }

    async open() {
      if (this.opened) return;
      if (this.closed) throw new Error('Connection was closed.');
      try {
        await this.link.subscribe(bytes => this.receive(bytes), error => this.remoteDisconnected(error));
        this.probeText = '';
        this.buffered = [];
        // The sole automatic write is the existing firmware-version query. No jog,
        // reset, firmware-update or radio-reconfiguration command is probed.
        const verified = this.waitFor(text => firmwareVersion(text), this.timeoutMs,
          'Bluetooth connected, but the AIRIZ text-command protocol was not confirmed. Motor controls remain disabled. Export diagnostics instead of guessing commands.');
        await Promise.all([
          this.send(FIRMWARE_QUERY).catch(error => {
            throw error && error.message ? error : stageError('write', error);
          }),
          verified
        ]);
        this.firmwareVersion = firmwareVersion(this.probeText);
        // Give the bridge a moment to append its #AUTH# line after the version.
        const auth = await this.waitFor(text => authReply(text) || null, 600, 'no-auth').catch(() => null);
        if (auth) {
          this.bridge = true;
          this.bridgeVersion = bridgeVersion(this.probeText);
          if (auth.state === 'required') await this.authenticate();
          else this.authenticated = auth.state === 'ok';
          if (this.bridgeVersion >= 3) await this.introduce();
        }
        if (this.closed) throw new Error('Device disconnected during verification.');
        this.opened = true;
        for (const bytes of this.buffered) this.readerController.enqueue(bytes);
        this.buffered = [];
      } catch (error) {
        await this.close();
        throw error;
      }
    }

    // Bridge v3: tell the AIRIZ who we are and ask who else is connected. Never
    // blocks the connection: missing answers are simply ignored.
    async introduce() {
      const label = root && typeof root.AirizDeviceLabel === 'function' ? root.AirizDeviceLabel() : 'Device';
      try {
        let mark = this.probeText.length;
        const hello = this.waitFor(text => {
          const match = /#HELLO#([0-9A-Fa-f:]*)#END#/.exec(text.slice(mark));
          return match ? match[1] || '-' : null;
        }, 2000, 'no-hello');
        await this.send('hello ' + label + '\n');
        const address = await hello.catch(() => '');
        this.myAddress = address && address !== '-' ? address.toUpperCase() : '';
        mark = this.probeText.length;
        const who = this.waitFor(text => parseWho(text.slice(mark)), 2000, 'no-who');
        await this.send('who\n');
        this.whoInfo = await who.catch(() => null);
        if (this.whoInfo) rememberWho(this.whoInfo);
      } catch (ignored) { /* optional information */ }
    }

    // Other devices connected to the same AIRIZ (not this one).
    get otherClients() {
      if (!this.whoInfo) return [];
      return this.whoInfo.clients.filter(client => client.address !== this.myAddress);
    }

    remoteDisconnected(error) {
      error = error || new Error('Bluetooth disconnected');
      if (this.closed) return;
      if (this.waiter) {
        clearTimeout(this.waiter.timer);
        this.waiter.reject(error);
        this.waiter = null;
      }
      this.closed = true;
      this.opened = false;
      try { this.readerController.error(error); } catch (ignored) { /* Already closed */ }
      Promise.resolve(this.link.close()).catch(() => {});
      if (this.onDisconnect) this.onDisconnect(this);
    }

    async close() {
      if (this.closed) return;
      this.closed = true;
      this.opened = false;
      if (this.waiter) {
        clearTimeout(this.waiter.timer);
        this.waiter.reject(new Error('Connection cancelled'));
        this.waiter = null;
      }
      try { await this.link.close(); } catch (ignored) { /* Device may already be gone */ }
      try { this.readerController.close(); } catch (ignored) { /* Reader may have been cancelled */ }
    }
  }

  // 1.11.25: the browser Web Bluetooth path (Connect Bluetooth, Bluefy on iPhone, its PIN
  // dialog) was removed from the UI in 1.11.18 and is now removed here too. Phones connect
  // with Remote by code; VerifiedSerialPort stays for the remote tunnel and the mobile app.

  // Turns an error without a message into one that says which step failed.
  function stageError(stage, error) {
    const name = error && error.name ? error.name : '';
    const message = error && error.message ? error.message : '';
    const detail = [name, message].filter(Boolean).join(': ') || String(error || 'unknown error');
    const wrapped = new Error('Bluetooth ' + stage + ' failed (' + detail + ').');
    wrapped.name = 'BluetoothStageError';
    wrapped.stage = stage;
    wrapped.cause = error;
    return wrapped;
  }

  return {
    FIRMWARE_QUERY, SPP_UUID, NUS_SERVICE, NUS_WRITE, NUS_NOTIFY, HM10_SERVICE,
    MOTOR_STOP_USB, MOTOR_STOP_BRIDGE,
    normalizeUuid, discoverProfiles, customProfile, firmwareVersion, authReply, chunks,
    parseWho, bridgeVersion, rememberWho, recallWho, describeClient,
    VerifiedSerialPort, stageError
  };
}));
