'use strict';

// 1.11.0: the AIRIZ on an Android phone's USB port - WebUSB CDC-ACM serial port (web/usb-serial.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUsbSerial } = require('../../web/usb-serial.js');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// The AIRIZ in CDC mode, as a Linux ACM gadget describes itself: a communication interface
// (interrupt notifications) and a data interface with one bulk endpoint each way.
function acmInterfaces(packetSize = 512) {
  return [
    {
      interfaceNumber: 0,
      alternates: [{
        alternateSetting: 0,
        interfaceClass: 0x02,
        interfaceSubclass: 0x02,
        interfaceProtocol: 0x01,
        endpoints: [{ endpointNumber: 3, direction: 'in', type: 'interrupt', packetSize: 10 }],
      }],
    },
    {
      interfaceNumber: 1,
      alternates: [{
        alternateSetting: 0,
        interfaceClass: 0x0a,
        interfaceSubclass: 0,
        interfaceProtocol: 0,
        endpoints: [
          { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize },
          { endpointNumber: 2, direction: 'out', type: 'bulk', packetSize },
        ],
      }],
    },
  ];
}

// The FT232R USB-serial cable: one vendor-class interface with a 64-byte bulk pair.
function ftdiInterfaces() {
  return [{
    interfaceNumber: 0,
    alternates: [{
      alternateSetting: 0,
      interfaceClass: 0xff,
      interfaceSubclass: 0xff,
      interfaceProtocol: 0xff,
      endpoints: [
        { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 64 },
        { endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 64 },
      ],
    }],
  }];
}

const FTDI_IDS = { vendorId: 0x0403, productId: 0x6001 };

class FakeDevice {
  constructor(interfaces, ids = {}) {
    this.vendorId = ids.vendorId ?? 0x0525;
    this.productId = ids.productId ?? 0xa4a7;
    this.configurations = [{ configurationValue: 1, interfaces }];
    this.configuration = null;
    this.opened = false;
    this.gone = false;
    this.claimed = new Set();
    this.claimFails = new Set();
    this.control = [];
    this.writes = [];
    this.reads = [];
    this.incoming = [];
    this.waiting = [];
    this.stallNextRead = false;
    this.halts = [];
  }

  async open() {
    if (this.gone) throw new DOMException('The device was disconnected.', 'NotFoundError');
    this.opened = true;
  }

  async close() {
    this.opened = false;
    this.claimed.clear();
    this.failReads(new DOMException('The device was closed.', 'AbortError'));
  }

  async selectConfiguration(value) {
    this.configuration = this.configurations.find(item => item.configurationValue === value);
  }

  async claimInterface(number) {
    if (this.claimFails.has(number)) throw new DOMException('Unable to claim interface.', 'NetworkError');
    this.claimed.add(number);
  }

  async releaseInterface(number) {
    if (this.gone) throw new DOMException('The device was disconnected.', 'NotFoundError');
    this.claimed.delete(number);
    this.failReads(new DOMException('The transfer was cancelled.', 'AbortError'));
  }

  async selectAlternateInterface() {}

  async controlTransferOut(setup, data) {
    if (setup.recipient === 'interface' && !this.claimed.has(setup.index)) {
      throw new DOMException('The interface is not claimed.', 'InvalidStateError');
    }
    this.control.push({ ...setup, data: data ? Array.from(new Uint8Array(data)) : null });
    return { status: 'ok', bytesWritten: data ? data.byteLength : 0 };
  }

  async clearHalt(direction, endpoint) {
    this.halts.push(`${direction}${endpoint}`);
  }

  transferIn(endpoint, length) {
    if (this.gone) return Promise.reject(new DOMException('A transfer error has occurred.', 'NetworkError'));
    this.reads.push({ endpoint, length });
    if (this.stallNextRead) {
      this.stallNextRead = false;
      return Promise.resolve({ status: 'stall', data: null });
    }
    if (this.incoming.length) return Promise.resolve(this.take(length));
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject, length }));
  }

  async transferOut(endpoint, data) {
    if (this.gone) throw new DOMException('A transfer error has occurred.', 'NetworkError');
    const bytes = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    this.writes.push({ endpoint, bytes });
    return { status: 'ok', bytesWritten: bytes.length };
  }

  take(length) {
    const bytes = this.incoming.shift();
    if (bytes.length > length) this.incoming.unshift(bytes.subarray(length));
    const part = bytes.subarray(0, length);
    return { status: 'ok', data: new DataView(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)) };
  }

  push(text) {
    const bytes = new TextEncoder().encode(text);
    if (this.vendorId === 0x0403) {
      for (let offset = 0; offset < bytes.length; offset += 62) {
        const part = bytes.subarray(offset, offset + 62);
        const packet = new Uint8Array(part.length + 2);
        packet.set([0x01, 0x60]);
        packet.set(part, 2);
        this.incoming.push(packet);
      }
    } else {
      this.incoming.push(bytes);
    }
    this.deliver();
  }

  pushStatusOnly() {
    this.incoming.push(new Uint8Array([0x01, 0x60]));
    this.deliver();
  }

  deliver() {
    while (this.waiting.length && this.incoming.length) {
      const reader = this.waiting.shift();
      reader.resolve(this.take(reader.length));
    }
  }

  failReads(error) {
    const pending = this.waiting.splice(0);
    for (const reader of pending) reader.reject(error);
  }

  unplug() {
    this.gone = true;
    this.opened = false;
    this.failReads(new DOMException('A transfer error has occurred.', 'NetworkError'));
  }

  written() {
    return this.writes.map(item => new TextDecoder().decode(item.bytes)).join('');
  }
}

class FakeUsb extends EventTarget {
  constructor(devices = []) {
    super();
    this.devices = devices;
    this.requests = [];
  }

  async requestDevice(options) {
    this.requests.push(options);
    if (!this.devices.length) throw new DOMException('No device selected.', 'NotFoundError');
    return this.devices[0];
  }

  async getDevices() {
    return this.devices.slice();
  }

  unplug(device) {
    device.unplug();
    this.devices = this.devices.filter(item => item !== device);
    const event = new Event('disconnect');
    event.device = device;
    this.dispatchEvent(event);
  }

  plug(device) {
    this.devices.push(device);
    const event = new Event('connect');
    event.device = device;
    this.dispatchEvent(event);
  }
}

function setup(options = {}) {
  const device = options.device || new FakeDevice(acmInterfaces(options.packetSize));
  const usb = 'usb' in options ? options.usb : new FakeUsb([device]);
  const navigator = { userAgent: options.userAgent || ANDROID_UA, maxTouchPoints: 5 };
  if (usb) navigator.usb = usb;
  return { device, usb, serial: createUsbSerial({ navigator }) };
}

const SERIAL_OPTIONS = { baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' };

async function readText(reader) {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

test('platform: Android uses the phone USB port; PCs keep Web Serial; iPhone and the app WebView get advice', () => {
  assert.equal(setup().serial.preferred(), true);
  assert.equal(setup({ userAgent: WINDOWS_UA }).serial.preferred(), false, 'Windows: the OS serial driver owns the port');
  const iphone = setup({ userAgent: IPHONE_UA, usb: null }).serial;
  assert.equal(iphone.preferred(), false);
  assert.match(iphone.unavailableReason(), /iPhone or iPad cannot use a USB cable/);
  const webView = setup({ usb: null }).serial;
  assert.equal(webView.preferred(), false);
  assert.match(webView.unavailableReason(), /works in Chrome/);
  assert.equal(setup({ userAgent: WINDOWS_UA, usb: null }).serial.unavailableReason(), '');
});

test('descriptors: finds the CDC data and control interfaces, vendor serial, and refuses other devices', () => {
  const { serial } = setup();
  const gadget = new FakeDevice(acmInterfaces(64));
  assert.deepEqual(serial.findSerialLayout(gadget, { interfaces: acmInterfaces(64) }), {
    driver: 'cdc', control: 0, data: 1, dataAlternate: 0, input: 1, output: 2, readBytes: 64, statusBytes: 0,
  });
  const vendor = [{
    interfaceNumber: 2,
    alternates: [{
      alternateSetting: 0,
      interfaceClass: 0xff,
      endpoints: [
        { endpointNumber: 5, direction: 'out', type: 'bulk', packetSize: 64 },
        { endpointNumber: 6, direction: 'in', type: 'bulk', packetSize: 64 },
      ],
    }],
  }];
  assert.deepEqual(serial.findSerialLayout(gadget, { interfaces: vendor }), {
    driver: 'cdc', control: null, data: 2, dataAlternate: 0, input: 6, output: 5, readBytes: 64, statusBytes: 0,
  });
  const camera = [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0x0e, endpoints: [] }] }];
  assert.equal(serial.findSerialLayout(gadget, { interfaces: camera }), null, 'UVC camera mode has no serial port');
  assert.deepEqual(
    Array.from(new Uint8Array(serial.lineCoding(SERIAL_OPTIONS))),
    [0x00, 0xc2, 0x01, 0x00, 0, 0, 8],
    '115200 baud, 1 stop bit, no parity, 8 data bits',
  );
});

test('open: chooser filters, claims both interfaces, sets 115200 8N1 and DTR+RTS', async () => {
  const { device, usb, serial } = setup();
  const port = await serial.requestPort();
  assert.ok(serial.isUsbCablePort(port));
  assert.ok(usb.requests[0].filters.some(filter => filter.classCode === 0x02), 'CDC devices are offered');
  assert.deepEqual(port.getInfo(), { usbVendorId: 0x0525, usbProductId: 0xa4a7 });
  await port.open(SERIAL_OPTIONS);
  assert.ok(device.opened);
  assert.deepEqual([...device.claimed].sort(), [0, 1]);
  assert.equal(device.control.length, 2);
  assert.deepEqual(device.control[0], {
    requestType: 'class', recipient: 'interface', request: 0x20, value: 0, index: 0, data: [0x00, 0xc2, 0x01, 0x00, 0, 0, 8],
  });
  assert.deepEqual(device.control[1], {
    requestType: 'class', recipient: 'interface', request: 0x22, value: 3, index: 0, data: null,
  });
  await assert.rejects(port.open(SERIAL_OPTIONS), { name: 'InvalidStateError' });
  await port.close();
});

test('data: reads one packet at a time, writes in chunks, survives a stalled read', async () => {
  const { device, serial } = setup({ packetSize: 64 });
  const port = await serial.requestPort();
  // The stream starts reading as soon as it exists, so the first read is the one that stalls.
  device.stallNextRead = true;
  await port.open(SERIAL_OPTIONS);
  const reader = port.readable.getReader();
  device.push('~ # ');
  assert.equal(await readText(reader), '~ # ');
  assert.ok(device.reads.every(read => read.length === 64), 'one packet per read never waits for a zero-length packet');
  assert.deepEqual(device.halts, ['in1'], 'a stalled read clears the halt and reads on');
  device.push('#INFO#0:0.0.0.9#END#\r\n');
  assert.equal(await readText(reader), '#INFO#0:0.0.0.9#END#\r\n');

  const writer = port.writable.getWriter();
  await writer.write(new TextEncoder().encode('diag ver sw\r\n'));
  const big = 'x'.repeat(40000);
  await writer.write(new TextEncoder().encode(big));
  assert.equal(device.written(), 'diag ver sw\r\n' + big);
  assert.deepEqual(device.writes.slice(1).map(item => item.bytes.length), [16384, 16384, 7232]);
  assert.ok(device.writes.every(item => item.endpoint === 2));
  writer.releaseLock();
  await reader.cancel();
  reader.releaseLock();
  await port.close();
  assert.equal(device.opened, false);
  assert.equal(device.claimed.size, 0);
  assert.deepEqual(device.control.at(-1).value, 0, 'DTR and RTS are dropped on close');
});

test('unplug: the read fails, readable and writable become null, close still succeeds', async () => {
  const { device, usb, serial } = setup();
  const port = await serial.requestPort();
  await port.open(SERIAL_OPTIONS);
  const reader = port.readable.getReader();
  const pending = reader.read();
  usb.unplug(device);
  await assert.rejects(pending, { name: 'NetworkError' });
  assert.equal(port.readable, null);
  assert.equal(port.writable, null);
  await port.close();
  assert.equal(port.state, 'closed');
});

test('a failed write reports NetworkError so the console treats the AIRIZ as lost', async () => {
  const { device, serial } = setup();
  const port = await serial.requestPort();
  await port.open(SERIAL_OPTIONS);
  const writer = port.writable.getWriter();
  device.gone = true;
  await assert.rejects(writer.write(new TextEncoder().encode('diag ver sw\r\n')), { name: 'NetworkError' });
  assert.equal(port.readable, null);
  await port.close();
});

test('control interface busy: data still flows without line settings', async () => {
  const device = new FakeDevice(acmInterfaces());
  device.claimFails.add(0);
  const { serial } = setup({ device });
  const port = await serial.requestPort();
  await port.open(SERIAL_OPTIONS);
  assert.deepEqual([...device.claimed], [1]);
  assert.equal(device.control.length, 0);
  const reader = port.readable.getReader();
  device.push('~ # ');
  assert.equal(await readText(reader), '~ # ');
  await reader.cancel();
  await port.close();
});

test('data interface busy: open fails cleanly and can be retried', async () => {
  const device = new FakeDevice(acmInterfaces());
  device.claimFails.add(1);
  const { serial } = setup({ device });
  const port = await serial.requestPort();
  await assert.rejects(port.open(SERIAL_OPTIONS), { name: 'NetworkError' });
  assert.equal(device.opened, false);
  device.claimFails.clear();
  await port.open(SERIAL_OPTIONS);
  assert.ok(port.readable);
  await port.close();
});

test('a device without a serial port is refused with advice about the cable', async () => {
  const camera = new FakeDevice([{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0x0e, endpoints: [] }] }]);
  const { serial } = setup({ device: camera });
  const port = await serial.requestPort();
  await assert.rejects(port.open(SERIAL_OPTIONS), error => error.name === 'NotFoundError' && /FT232R/.test(error.message));
  assert.equal(camera.opened, false);
});

test('reconnect: getPorts keeps the same port per device, skips other devices, and replugs are announced', async () => {
  const device = new FakeDevice(acmInterfaces());
  const camera = new FakeDevice([{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0x0e, endpoints: [] }] }], { productId: 1 });
  const usb = new FakeUsb([device, camera]);
  const { serial } = setup({ device, usb });
  const first = await serial.getPorts();
  const second = await serial.getPorts();
  assert.equal(first.length, 1);
  assert.equal(first[0], second[0], 'same object, so the console recognises its port');
  const seen = [];
  const stop = serial.onConnect(plugged => seen.push(plugged));
  const replugged = new FakeDevice(acmInterfaces());
  usb.plug(replugged);
  assert.deepEqual(seen, [replugged]);
  stop();
  usb.plug(new FakeDevice(acmInterfaces()));
  assert.equal(seen.length, 1);
  const ports = await serial.getPorts();
  assert.equal(ports.filter(port => port.getInfo().usbProductId === 0xa4a7).length, 3);
});

test('requestPort without a chosen device rejects with NotFoundError (the console stays quiet)', async () => {
  const { serial } = setup({ usb: new FakeUsb([]) });
  await assert.rejects(serial.requestPort(), { name: 'NotFoundError' });
});

test('FTDI maths: baud divisors match the FTDI tables, 8N1, status bytes are removed per packet', () => {
  const { serial } = setup();
  assert.equal(serial.ftdiDivisor(115200, false), 0x001a, '115200 baud = 0x001A on FT232R');
  assert.equal(serial.ftdiDivisor(9600, false), 0x4138, '9600 baud = 0x4138');
  assert.equal(serial.ftdiDivisor(230400, false), 0x000d, '230400 baud = 0x000D');
  assert.equal(serial.ftdiDivisor(3000000, false), 0, '3 Mbaud special case');
  assert.equal(serial.ftdiDivisor(115200, true) & 0x20000, 0x20000, 'H chips set the 120 MHz bit');
  assert.equal(serial.ftdiDataValue(SERIAL_OPTIONS), 0x0008, '8 data bits, no parity, 1 stop bit');
  const one = new Uint8Array([0x01, 0x60, 65, 66, 67]);
  assert.deepEqual(Array.from(serial.stripStatus(one, 64, 2)), [65, 66, 67]);
  const two = new Uint8Array(64 + 4);
  two.set([0x01, 0x60]);
  two.fill(88, 2, 64);
  two.set([0x01, 0x60, 89, 90], 64);
  const stripped = serial.stripStatus(two, 64, 2);
  assert.equal(stripped.length, 62 + 2);
  assert.deepEqual(Array.from(stripped.slice(-3)), [88, 89, 90]);
  assert.equal(serial.stripStatus(new Uint8Array([0x01, 0x60]), 64, 2).length, 0, 'status-only packet');
});

test('FT232R cable: reset, DTR/RTS, no flow control, 115200 baud, 8N1, purge - then clean console text', async () => {
  const device = new FakeDevice(ftdiInterfaces(), FTDI_IDS);
  const { usb, serial } = setup({ device });
  const port = await serial.requestPort();
  assert.ok(usb.requests[0].filters.some(filter => filter.vendorId === 0x0403), 'FTDI cables are offered');
  assert.equal(port.driver, 'ftdi');
  await port.open(SERIAL_OPTIONS);
  assert.deepEqual([...device.claimed], [0]);
  const vendor = (request, value, index = 0) => ({ requestType: 'vendor', recipient: 'device', request, value, index, data: null });
  assert.deepEqual(device.control, [
    vendor(0x00, 0),
    vendor(0x01, 0x0303),
    vendor(0x02, 0),
    vendor(0x03, 0x001a),
    vendor(0x04, 0x0008),
    vendor(0x00, 1),
    vendor(0x00, 2),
  ]);
  const reader = port.readable.getReader();
  device.pushStatusOnly();
  device.pushStatusOnly();
  device.push('~ # ');
  assert.equal(await readText(reader), '~ # ', 'status-only packets are skipped, status bytes removed');
  const long = '#INFO#0:0.0.0.9#END#\r\n'.repeat(5);
  device.push(long);
  let received = '';
  while (received.length < long.length) received += await readText(reader);
  assert.equal(received, long, 'text split over several 64-byte packets arrives intact');
  const writer = port.writable.getWriter();
  await writer.write(new TextEncoder().encode('diag ver sw\r\n'));
  assert.equal(device.written(), 'diag ver sw\r\n', 'writes carry no header');
  writer.releaseLock();
  await reader.cancel();
  await port.close();
  assert.deepEqual(device.control.at(-1), vendor(0x01, 0x0300), 'DTR and RTS off on close');
  assert.equal(device.opened, false);
});

test('FT232R cable: a refused baud rate fails the open with clear advice', async () => {
  const device = new FakeDevice(ftdiInterfaces(), FTDI_IDS);
  const original = device.controlTransferOut.bind(device);
  device.controlTransferOut = async (setup, data) => (setup.request === 0x03 ? { status: 'stall' } : original(setup, data));
  const { serial } = setup({ device });
  const port = await serial.requestPort();
  await assert.rejects(port.open(SERIAL_OPTIONS), error => error.name === 'NetworkError' && /baud rate/.test(error.message));
  assert.equal(device.opened, false);
  assert.equal(port.state, 'closed');
});
