export const FIRMWARE_QUERY = 'diag ver sw\r\n';
export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
const BASE = '-0000-1000-8000-00805f9b34fb';

export function normalizeUuid(value) {
  const text = String(value).toLowerCase();
  if (/^[a-f0-9]{4}$/.test(text)) return '0000' + text + BASE;
  if (/^[a-f0-9]{8}$/.test(text)) return text + BASE;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(text)) throw new Error('Invalid Bluetooth UUID');
  return text;
}

const UART_PROFILES = [
  {
    name: 'Nordic UART',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
  },
  {
    name: 'HM-10-style UART',
    service: '0000ffe0' + BASE,
    write: '0000ffe1' + BASE,
    notify: '0000ffe1' + BASE
  }
];

export function discoverProfiles(services) {
  const found = [];
  for (const profile of UART_PROFILES) {
    const service = services.find(item => normalizeUuid(item.uuid) === profile.service);
    if (!service) continue;
    const write = service.characteristics.find(item => normalizeUuid(item.uuid) === profile.write);
    const notify = service.characteristics.find(item => normalizeUuid(item.uuid) === profile.notify);
    if (write && notify && (write.properties.write || write.properties.writeWithoutResponse)
        && (notify.properties.notify || notify.properties.indicate)) {
      found.push({ ...profile, withoutResponse: !write.properties.write });
    }
  }
  return found;
}

export function customProfile(services, serviceId, writeId, notifyId) {
  serviceId = normalizeUuid(serviceId);
  writeId = normalizeUuid(writeId);
  notifyId = normalizeUuid(notifyId);
  // Never probe standard GATT/DFU services as if they were a command console.
  if (serviceId.endsWith(BASE) || serviceId === '00001530-1212-efde-1523-785feabcd123') {
    throw new Error('Standard/DFU services cannot be used as a custom motor-command channel.');
  }
  const service = services.find(item => normalizeUuid(item.uuid) === serviceId);
  const write = service?.characteristics.find(item => normalizeUuid(item.uuid) === writeId);
  const notify = service?.characteristics.find(item => normalizeUuid(item.uuid) === notifyId);
  if (!write || !notify || !(write.properties.write || write.properties.writeWithoutResponse)
      || !(notify.properties.notify || notify.properties.indicate)) {
    throw new Error('Choose writable and notifying characteristics from the same vendor service.');
  }
  return { name: 'User-selected text channel', service: serviceId, write: writeId, notify: notifyId, withoutResponse: !write.properties.write };
}

export function firmwareVersion(text) {
  for (const match of text.matchAll(/#INFO#([\s\S]{0,512}?)#END#/g)) {
    const block = match[1].trim();
    const direct = /^(?:\d+:)?v?(\d+(?:\.\d+){2,3})$/i.exec(block);
    const labeled = /\b(?:firmware|software|version|sw)\b[^\r\n]{0,30}?\b(\d+(?:\.\d+){2,3})\b/i.exec(block);
    if (direct || labeled) return (direct || labeled)[1];
  }
  return null;
}

export function chunks(bytes, size = 20) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Invalid packet size');
  const result = [];
  for (let offset = 0; offset < bytes.length; offset += size) result.push(bytes.slice(offset, offset + size));
  return result;
}

export class VerifiedSerialPort {
  constructor(link, onDisconnect, timeoutMs = 8000) {
    this.link = link;
    this.transportLabel = link.label;
    this.firmwareVersion = null;
    this.opened = false;
    this.closed = false;
    this.timeoutMs = timeoutMs;
    this.onDisconnect = onDisconnect;
    this.buffered = [];
    this.probeText = '';
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

  receive(value) {
    const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    if (this.closed) return;
    if (this.opened) {
      this.readerController.enqueue(bytes);
      return;
    }
    this.buffered.push(bytes);
    this.probeText = (this.probeText + this.decoder.decode(bytes, { stream: true })).slice(-65536);
    const version = firmwareVersion(this.probeText);
    if (version && this.resolveProbe) {
      this.firmwareVersion = version;
      this.resolveProbe(version);
    }
  }

  async open() {
    if (this.opened) return;
    if (this.closed) throw new Error('Connection was closed.');
    try {
      await this.link.subscribe(bytes => this.receive(bytes), error => this.remoteDisconnected(error));
      const verified = new Promise((resolve, reject) => {
        this.resolveProbe = resolve;
        this.rejectProbe = reject;
        this.timer = setTimeout(() => reject(new Error('Bluetooth connected, but the AIRIZ text-command protocol was not confirmed. Motor controls remain disabled. Export diagnostics instead of guessing commands.')), this.timeoutMs);
      });
      // The sole automatic write is the existing firmware-version query. No jog,
      // reset, firmware-update or radio-reconfiguration command is probed.
      this.probeText = '';
      this.buffered = [];
      const writing = Promise.resolve().then(() => this.link.write(new TextEncoder().encode(FIRMWARE_QUERY)));
      await Promise.all([writing, verified]);
      if (this.closed) throw new Error('Device disconnected during verification.');
      clearTimeout(this.timer);
      this.resolveProbe = null;
      this.rejectProbe = null;
      this.opened = true;
      for (const bytes of this.buffered) this.readerController.enqueue(bytes);
      this.buffered = [];
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  remoteDisconnected(error = new Error('Bluetooth disconnected')) {
    if (this.closed) return;
    this.rejectProbe?.(error);
    clearTimeout(this.timer);
    this.closed = true;
    this.opened = false;
    try { this.readerController.error(error); } catch { /* Already closed */ }
    Promise.resolve(this.link.close()).catch(() => {});
    this.onDisconnect?.(this);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.opened = false;
    clearTimeout(this.timer);
    this.rejectProbe?.(new Error('Connection cancelled'));
    this.resolveProbe = null;
    this.rejectProbe = null;
    try { await this.link.close(); } catch { /* Device may already be gone */ }
    try { this.readerController.close(); } catch { /* Reader may have been cancelled */ }
  }
}
