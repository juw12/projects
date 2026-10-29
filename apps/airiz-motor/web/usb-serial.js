/* AIRIZ Console 1.11.0 - the AIRIZ console cable on an Android phone (no PC needed).
 *
 * PCs open the AIRIZ console (the FT232R USB-serial cable, or the AIRIZ's own USB port in
 * "diag usbmode set cdc" mode) with Web Serial. Chrome on Android lists USB serial ports only
 * from Android 17, but it has had WebUSB for years, so on Android this module drives the cable
 * itself:
 *   FTDI (FT232R and other FTDI chips, USB vendor 0x0403): vendor requests for reset, DTR/RTS,
 *        no flow control, baud divisor and 8N1; every IN packet starts with 2 status bytes,
 *        which are removed.
 *   CDC-ACM (the AIRIZ USB port in CDC mode, other standard serial gadgets): SET_LINE_CODING
 *        and SET_CONTROL_LINE_STATE on the control interface; plain bulk data.
 * requestPort() and getPorts() return objects with the Web Serial SerialPort shape (open, close,
 * readable, writable, getInfo), so app.js treats the phone's cable exactly like a USB serial
 * port on a PC: same prompt, motor controls, Stop motor, macros, talk and listen, reconnect after
 * a replug, and Share control (the phone becomes the "PC" that other phones control by code).
 *
 * Needs an Android phone or tablet with USB OTG and Chrome (WebUSB). Not available on iPhone or
 * iPad (no WebUSB) or in the AIRIZ Android app's WebView. PCs keep using Web Serial, because the
 * Windows serial driver owns the cable there. Loaded as a plain script (window.AirizUsbSerial)
 * and by the Node tests (createUsbSerial with a fake navigator).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { createUsbSerial: factory };
  if (root && root.navigator) root.AirizUsbSerial = factory({ navigator: root.navigator });
})(typeof window !== 'undefined' ? window : null, function createUsbSerial(env) {
  'use strict';

  const nav = (env && env.navigator) || {};
  const usb = nav.usb || null;
  const DomError = (env && env.DOMException) || (typeof DOMException === 'function' ? DOMException : null);

  const CDC_COMM_CLASS = 0x02;
  const CDC_DATA_CLASS = 0x0a;
  const VENDOR_CLASS = 0xff;
  const SET_LINE_CODING = 0x20;
  const SET_CONTROL_LINE_STATE = 0x22;
  const DTR_AND_RTS = 0x03;
  const FTDI_VENDOR = 0x0403;
  // FTDI vendor requests (as in the Linux ftdi_sio driver).
  const FTDI_RESET = 0x00;
  const FTDI_MODEM_CTRL = 0x01;
  const FTDI_FLOW_CTRL = 0x02;
  const FTDI_BAUD_RATE = 0x03;
  const FTDI_DATA = 0x04;
  const FTDI_PURGE_RX = 1;
  const FTDI_PURGE_TX = 2;
  const FTDI_DTR_RTS_ON = 0x0303;
  const FTDI_DTR_RTS_OFF = 0x0300;
  const FTDI_STATUS_BYTES = 2;
  // FT2232H, FT4232H and FT232H use the 120 MHz high-speed baud generator.
  const FTDI_HIGH_SPEED_PRODUCTS = [0x6010, 0x6011, 0x6014];
  const WRITE_BYTES = 16384;
  const PUBLIC_CONSOLE_URL = 'https://juw12.github.io/projects/airiz-motor/';
  // Shown in Chrome's device chooser: FTDI cables (FT232R), CDC serial ports and vendor serial gadgets.
  const DEVICE_FILTERS = [
    { vendorId: FTDI_VENDOR },
    { classCode: CDC_COMM_CLASS },
    { classCode: CDC_DATA_CLASS },
    { classCode: VENDOR_CLASS },
  ];

  const MESSAGES = {
    iphone: 'An iPhone or iPad cannot use a USB cable to the AIRIZ (Apple allows no USB serial ports in browsers or apps). Use Connect by code, or Connect Bluetooth.',
    androidChrome: 'On an Android phone the USB cable works in Chrome: open ' + PUBLIC_CONSOLE_URL + ' in Chrome, plug in the AIRIZ, then press Connect.',
    noSerialPort: 'This USB device is not a serial cable. Use the FT232R USB-serial cable (or the AIRIZ USB port in CDC mode).',
    baudFailed: 'The USB-serial cable did not accept the baud rate. Unplug and replug it, then press Connect.',
    unplugged: 'The USB cable was unplugged.',
    closed: 'The USB port is closed.',
    stalled: 'The AIRIZ did not accept the data (USB stall).',
    busy: 'The port is already open.',
    noWebUsb: 'WebUSB is not available in this browser.',
  };

  function makeError(name, message) {
    if (DomError) {
      try {
        return new DomError(message, name);
      } catch (ignored) { /* fall through to a plain Error */ }
    }
    const fallback = new Error(message);
    fallback.name = name;
    return fallback;
  }

  // ---------------------------------------------------------------- platform

  function userAgent() {
    return String(nav.userAgent || '');
  }

  function isAndroid() {
    if (/Android/i.test(userAgent())) return true;
    const data = nav.userAgentData;
    return !!(data && /android/i.test(String(data.platform || '')));
  }

  function isAppleMobile() {
    const agent = userAgent();
    return /iPhone|iPad|iPod/i.test(agent) || (/Macintosh/i.test(agent) && Number(nav.maxTouchPoints) > 1);
  }

  function available() {
    return !!(usb && typeof usb.requestDevice === 'function');
  }

  // Android phones and tablets use their own USB host port; PCs keep Web Serial.
  function preferred() {
    return available() && isAndroid();
  }

  // Why the USB cable cannot be used in this browser ('' = no special advice).
  function unavailableReason() {
    if (isAppleMobile()) return MESSAGES.iphone;
    if (isAndroid() && !available()) return MESSAGES.androidChrome;
    return '';
  }

  // ---------------------------------------------------------------- USB descriptors

  function bulkPair(alternate) {
    const endpoints = (alternate && alternate.endpoints) || [];
    const input = endpoints.find(endpoint => endpoint.direction === 'in' && endpoint.type === 'bulk');
    const output = endpoints.find(endpoint => endpoint.direction === 'out' && endpoint.type === 'bulk');
    return input && output ? { input, output } : null;
  }

  function isFtdi(device) {
    return !!device && device.vendorId === FTDI_VENDOR;
  }

  // FTDI: the first interface with a bulk pair. Multi-port chips address a port as interface + 1.
  function findFtdiLayout(configuration, productId) {
    if (!configuration || !Array.isArray(configuration.interfaces)) return null;
    const interfaces = configuration.interfaces;
    for (const iface of interfaces) {
      for (const alternate of iface.alternates || []) {
        const pair = bulkPair(alternate);
        if (!pair) continue;
        return {
          driver: 'ftdi',
          control: null,
          data: iface.interfaceNumber,
          dataAlternate: alternate.alternateSetting || 0,
          input: pair.input.endpointNumber,
          output: pair.output.endpointNumber,
          readBytes: pair.input.packetSize || 64,
          statusBytes: FTDI_STATUS_BYTES,
          portIndex: interfaces.length > 1 ? iface.interfaceNumber + 1 : 0,
          multiPort: interfaces.length > 1,
          highSpeed: FTDI_HIGH_SPEED_PRODUCTS.includes(productId),
        };
      }
    }
    return null;
  }

  // CDC: the CDC data interface (or a vendor interface with a bulk pair), plus the CDC
  // communication interface that takes the line settings, if there is one.
  function findCdcLayout(configuration) {
    if (!configuration || !Array.isArray(configuration.interfaces)) return null;
    const interfaces = configuration.interfaces;
    let data = null;
    for (const wantedClass of [CDC_DATA_CLASS, VENDOR_CLASS]) {
      for (const iface of interfaces) {
        for (const alternate of iface.alternates || []) {
          if (alternate.interfaceClass !== wantedClass) continue;
          const pair = bulkPair(alternate);
          if (pair) {
            data = { iface, alternate, pair };
            break;
          }
        }
        if (data) break;
      }
      if (data) break;
    }
    if (!data) return null;
    const comms = interfaces.filter(iface => (iface.alternates || []).some(alternate => alternate.interfaceClass === CDC_COMM_CLASS));
    const control = comms.find(iface => iface.interfaceNumber === data.iface.interfaceNumber - 1) || comms[0] || null;
    return {
      driver: 'cdc',
      control: control ? control.interfaceNumber : null,
      data: data.iface.interfaceNumber,
      dataAlternate: data.alternate.alternateSetting || 0,
      input: data.pair.input.endpointNumber,
      output: data.pair.output.endpointNumber,
      // One packet per read: a read of exactly one packet never waits for a zero-length packet.
      readBytes: data.pair.input.packetSize || 64,
      statusBytes: 0,
    };
  }

  function findSerialLayout(device, configuration) {
    return isFtdi(device) ? findFtdiLayout(configuration, device.productId) : findCdcLayout(configuration);
  }

  function hasSerialPort(device) {
    const configurations = (device && device.configurations) || [];
    if (!configurations.length) return true; // not described before opening: try it
    return configurations.some(configuration => !!findSerialLayout(device, configuration));
  }

  // CDC SET_LINE_CODING payload: dwDTERate (little-endian), bCharFormat, bParityType, bDataBits.
  function lineCoding(options) {
    const settings = options || {};
    const buffer = new ArrayBuffer(7);
    const view = new DataView(buffer);
    view.setUint32(0, Number(settings.baudRate) || 115200, true);
    view.setUint8(4, settings.stopBits === 2 ? 2 : 0);
    view.setUint8(5, ({ none: 0, odd: 1, even: 2 })[settings.parity] || 0);
    view.setUint8(6, Number(settings.dataBits) || 8);
    return buffer;
  }

  // FTDI baud divisor (ftdi_sio: 232BM/R/X chips from 48 MHz, H chips from 120 MHz).
  function ftdiDivisor(baudRate, highSpeed) {
    const fraction = [0, 3, 2, 4, 1, 5, 6, 7];
    const baud = Number(baudRate) || 115200;
    const divisor3 = highSpeed ? Math.round((8 * 120000000) / (10 * baud)) : Math.round(48000000 / (2 * baud));
    let divisor = (divisor3 >> 3) | (fraction[divisor3 & 7] << 14);
    if (divisor === 1) divisor = 0;
    else if (divisor === 0x4001) divisor = 1;
    if (highSpeed) divisor |= 0x20000;
    return divisor;
  }

  // FTDI SET_DATA value: data bits, parity (bits 8-10), stop bits (bits 11-12).
  function ftdiDataValue(options) {
    const settings = options || {};
    const parity = ({ none: 0, odd: 1, even: 2 })[settings.parity] || 0;
    const stop = settings.stopBits === 2 ? 2 : 0;
    return (Number(settings.dataBits) || 8) | (parity << 8) | (stop << 11);
  }

  // FTDI packets start with 2 modem/line status bytes; status-only packets carry no data.
  function stripStatus(bytes, packetSize, statusBytes) {
    if (!statusBytes) return bytes;
    const parts = [];
    let total = 0;
    for (let offset = 0; offset < bytes.length; offset += packetSize) {
      const part = bytes.subarray(offset + statusBytes, Math.min(bytes.length, offset + packetSize));
      if (part.length) {
        parts.push(part);
        total += part.length;
      }
    }
    const data = new Uint8Array(total);
    let position = 0;
    for (const part of parts) {
      data.set(part, position);
      position += part.length;
    }
    return data;
  }

  // ---------------------------------------------------------------- the port

  class UsbSerialPort {
    constructor(device) {
      this.device = device;
      this.readable = null;
      this.writable = null;
      this.layout = null;
      this.state = 'closed'; // closed | opening | open | lost | closing
      this.readController = null;
    }

    getInfo() {
      return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
    }

    get driver() {
      return this.layout ? this.layout.driver : (isFtdi(this.device) ? 'ftdi' : 'cdc');
    }

    async open(options) {
      if (this.state !== 'closed') throw makeError('InvalidStateError', MESSAGES.busy);
      this.state = 'opening';
      const device = this.device;
      try {
        if (!device.opened) await device.open();
        if (!device.configuration) await device.selectConfiguration(1);
        const layout = findSerialLayout(device, device.configuration);
        if (!layout) throw makeError('NotFoundError', MESSAGES.noSerialPort);
        if (layout.control !== null) {
          try {
            await device.claimInterface(layout.control);
          } catch (ignored) {
            layout.control = null; // data still flows; only the line settings are skipped
          }
        }
        await device.claimInterface(layout.data);
        if (layout.dataAlternate) await device.selectAlternateInterface(layout.data, layout.dataAlternate);
        this.layout = layout;
        if (layout.driver === 'ftdi') {
          await this.setupFtdi(options);
        } else {
          await this.controlOut(SET_LINE_CODING, 0, lineCoding(options));
          await this.controlOut(SET_CONTROL_LINE_STATE, DTR_AND_RTS);
        }
      } catch (error) {
        this.layout = null;
        this.state = 'closed';
        try {
          if (device.opened) await device.close();
        } catch (ignored) { /* already closed */ }
        throw error;
      }
      this.state = 'open';
      this.readable = this.makeReadable();
      this.writable = this.makeWritable();
    }

    // FTDI: reset, DTR+RTS on, no flow control, baud rate, 8N1, then empty both buffers.
    async setupFtdi(options) {
      const layout = this.layout;
      const port = layout.portIndex;
      const divisor = ftdiDivisor(options && options.baudRate, layout.highSpeed);
      const baudIndex = layout.multiPort ? (((divisor >> 16) & 0xff) << 8) | port : (divisor >> 16) & 0xffff;
      await this.vendorOut(FTDI_RESET, 0, port);
      await this.vendorOut(FTDI_MODEM_CTRL, FTDI_DTR_RTS_ON, port);
      await this.vendorOut(FTDI_FLOW_CTRL, 0, port);
      if (!(await this.vendorOut(FTDI_BAUD_RATE, divisor & 0xffff, baudIndex))) {
        throw makeError('NetworkError', MESSAGES.baudFailed);
      }
      await this.vendorOut(FTDI_DATA, ftdiDataValue(options), port);
      await this.vendorOut(FTDI_RESET, FTDI_PURGE_RX, port);
      await this.vendorOut(FTDI_RESET, FTDI_PURGE_TX, port);
    }

    async vendorOut(request, value, index) {
      try {
        const result = await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request, value, index });
        return !!result && result.status === 'ok';
      } catch (ignored) {
        return false;
      }
    }

    // CDC class request to the communication interface. A gadget that ignores line settings
    // still passes data, so a failure here is not fatal.
    async controlOut(request, value, data) {
      if (!this.layout || this.layout.control === null) return false;
      const setup = { requestType: 'class', recipient: 'interface', request, value, index: this.layout.control };
      try {
        const result = data === undefined
          ? await this.device.controlTransferOut(setup)
          : await this.device.controlTransferOut(setup, data);
        return !!result && result.status === 'ok';
      } catch (ignored) {
        return false;
      }
    }

    makeReadable() {
      const port = this;
      const layout = this.layout;
      return new ReadableStream({
        start(controller) {
          port.readController = controller;
        },
        async pull(controller) {
          while (port.state === 'open') {
            let result;
            try {
              result = await port.device.transferIn(layout.input, layout.readBytes);
            } catch (error) {
              port.lost(error);
              return;
            }
            if (port.state !== 'open') return;
            if (result.status === 'stall') {
              try {
                await port.device.clearHalt('in', layout.input);
              } catch (error) {
                port.lost(error);
                return;
              }
              continue;
            }
            const view = result.data;
            if (result.status !== 'ok' || !view || !view.byteLength) continue; // zero-length packet or babble
            const raw = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
            const bytes = stripStatus(raw, layout.readBytes, layout.statusBytes);
            if (!bytes.length) continue; // FTDI status-only packet
            try {
              controller.enqueue(bytes);
            } catch (ignored) { /* stream closed meanwhile */ }
            return;
          }
        },
        cancel() {
          port.readController = null;
        },
      });
    }

    makeWritable() {
      const port = this;
      const layout = this.layout;
      return new WritableStream({
        async write(chunk) {
          if (port.state !== 'open') throw makeError('InvalidStateError', MESSAGES.closed);
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          for (let offset = 0; offset < bytes.length; offset += WRITE_BYTES) {
            const part = bytes.subarray(offset, Math.min(bytes.length, offset + WRITE_BYTES));
            let result;
            try {
              result = await port.device.transferOut(layout.output, part);
            } catch (error) {
              port.lost(error);
              throw makeError('NetworkError', (error && error.message) || MESSAGES.unplugged);
            }
            if (result && result.status === 'stall') {
              try {
                await port.device.clearHalt('out', layout.output);
              } catch (ignored) { /* reported below */ }
              throw makeError('NetworkError', MESSAGES.stalled);
            }
          }
        },
      });
    }

    // The cable was pulled or the phone dropped the device: end the streams like Web Serial
    // does after a fatal error (readable and writable become null), so the console reconnects.
    lost(error) {
      if (this.state !== 'open') return;
      this.state = 'lost';
      const reason = error && error.name === 'NetworkError' ? error : makeError('NetworkError', MESSAGES.unplugged);
      const controller = this.readController;
      this.readController = null;
      if (controller) {
        try {
          controller.error(reason);
        } catch (ignored) { /* already closed */ }
      }
      this.readable = null;
      this.writable = null;
    }

    async close() {
      if (this.state === 'closed') return;
      const wasOpen = this.state === 'open';
      this.state = 'closing';
      const controller = this.readController;
      this.readController = null;
      if (controller) {
        try {
          controller.close();
        } catch (ignored) { /* already closed */ }
      }
      this.readable = null;
      this.writable = null;
      const device = this.device;
      const layout = this.layout;
      // Drop DTR/RTS so the AIRIZ sees the terminal go away (only while the device is still there).
      if (layout && wasOpen) {
        if (layout.driver === 'ftdi') await this.vendorOut(FTDI_MODEM_CTRL, FTDI_DTR_RTS_OFF, layout.portIndex);
        else await this.controlOut(SET_CONTROL_LINE_STATE, 0);
      }
      if (layout) {
        for (const number of [layout.data, layout.control]) {
          if (number === null) continue;
          try {
            await device.releaseInterface(number);
          } catch (ignored) { /* the device is gone */ }
        }
      }
      try {
        if (device.opened) await device.close();
      } catch (ignored) { /* the device is gone */ }
      this.layout = null;
      this.state = 'closed';
    }
  }

  // ---------------------------------------------------------------- devices

  const ports = new WeakMap();
  const connectListeners = new Set();

  function portFor(device) {
    let port = ports.get(device);
    if (!port) {
      port = new UsbSerialPort(device);
      ports.set(device, port);
    }
    return port;
  }

  if (usb && typeof usb.addEventListener === 'function') {
    usb.addEventListener('disconnect', event => {
      const port = event && event.device ? ports.get(event.device) : null;
      if (port) port.lost(makeError('NetworkError', MESSAGES.unplugged));
    });
    usb.addEventListener('connect', event => {
      for (const listener of connectListeners) {
        try {
          listener(event && event.device);
        } catch (error) {
          if (typeof console !== 'undefined') console.error(error);
        }
      }
    });
  }

  // Chrome shows its device chooser; Android then asks to allow Chrome to use the device.
  async function requestPort() {
    if (!available()) throw makeError('NotSupportedError', unavailableReason() || MESSAGES.noWebUsb);
    const device = await usb.requestDevice({ filters: DEVICE_FILTERS });
    return portFor(device);
  }

  // Devices this site may already use (for reconnecting after a replug).
  async function getPorts() {
    if (!available() || typeof usb.getDevices !== 'function') return [];
    const devices = await usb.getDevices();
    return devices.filter(hasSerialPort).map(portFor);
  }

  return Object.freeze({
    VERSION: '1.11.0',
    MESSAGES,
    available,
    preferred,
    isAndroid,
    unavailableReason,
    requestPort,
    getPorts,
    onConnect(listener) {
      connectListeners.add(listener);
      return () => connectListeners.delete(listener);
    },
    isUsbCablePort(port) {
      return port instanceof UsbSerialPort;
    },
    findSerialLayout,
    lineCoding,
    ftdiDivisor,
    ftdiDataValue,
    stripStatus,
  });
});
