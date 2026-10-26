import { Capacitor, registerPlugin } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { VerifiedSerialPort, discoverProfiles, customProfile, normalizeUuid, chunks } from './protocol.mjs';

const platform = Capacitor.getPlatform();
const Classic = registerPlugin('AirizClassicSerial');
let initialized = false;
let pending = null;
let currentLink = null;
let scanTimer;
let lastDiagnostics = null;
const serialEvents = new EventTarget();
const blobRegistry = new Map();
const encode64 = bytes => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};
const decode64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

async function saveFile(blob, filename) {
  if (blob.size > 20 * 1024 * 1024) throw new Error('This export exceeds the mobile preview limit of 20 MB. Use a shorter capture or the Windows app.');
  const safe = String(filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'airiz-export.txt';
  const saved = await Filesystem.writeFile({ path: 'exports/' + Date.now() + '-' + safe, data: encode64(new Uint8Array(await blob.arrayBuffer())), directory: Directory.Cache, recursive: true });
  await Share.share({ title: 'AIRIZ export', url: saved.uri, dialogTitle: 'Save or share AIRIZ output' });
}

function emitDisconnect(port) {
  const event = new Event('disconnect');
  Object.defineProperty(event, 'port', { value: port });
  serialEvents.dispatchEvent(event);
}

async function ensureBle() {
  if (!initialized) {
    await BleClient.initialize({ androidNeverForLocation: true });
    initialized = true;
  }
  if (!await BleClient.isEnabled()) {
    if (platform === 'android') await BleClient.requestEnable();
    if (!await BleClient.isEnabled()) throw new Error('Turn on Bluetooth in your phone settings, then scan again.');
  }
}

async function stopScan() {
  clearTimeout(scanTimer);
  if (initialized) await BleClient.stopLEScan().catch(() => {});
}

function bleLink(device, profile, disconnectRef) {
  let dataCallback;
  let disconnectCallback;
  disconnectRef.current = () => disconnectCallback?.(new Error('BLE connection lost'));
  return {
    label: 'Bluetooth LE · ' + profile.name,
    async subscribe(onData, onDisconnect) {
      dataCallback = onData;
      disconnectCallback = onDisconnect;
      await BleClient.startNotifications(device.deviceId, profile.service, profile.notify, value => dataCallback(value));
    },
    async write(bytes) {
      for (const part of chunks(bytes, 20)) {
        const value = new DataView(part.buffer, part.byteOffset, part.byteLength);
        if (profile.withoutResponse) {
          await BleClient.writeWithoutResponse(device.deviceId, profile.service, profile.write, value);
          await new Promise(resolve => setTimeout(resolve, 25));
        } else {
          await BleClient.write(device.deviceId, profile.service, profile.write, value);
        }
      }
    },
    async close() {
      disconnectCallback = null;
      await BleClient.stopNotifications(device.deviceId, profile.service, profile.notify).catch(() => {});
      await BleClient.disconnect(device.deviceId).catch(() => {});
    }
  };
}

async function classicLink(device) {
  await Classic.connect({ deviceId: device.deviceId });
  const listeners = [];
  return {
    label: 'Bluetooth Classic serial',
    async subscribe(onData, onDisconnect) {
      listeners.push(await Classic.addListener('data', event => {
        if (event.deviceId === device.deviceId) onData(decode64(event.value));
      }));
      listeners.push(await Classic.addListener('disconnected', event => {
        if (event.deviceId === device.deviceId) onDisconnect(new Error(event.message || 'Classic serial disconnected'));
      }));
    },
    async write(bytes) { await Classic.write({ value: encode64(bytes) }); },
    async close() {
      for (const listener of listeners) await listener.remove();
      await Classic.disconnect();
    }
  };
}

function installMobile() {
  if (localStorage.getItem('airiz.audioAutoSave') === null) localStorage.setItem('airiz.audioAutoSave', '0');
  window.airizMobile = Object.freeze({ native: true, platform, saveFile });
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: chooseDevice,
      addEventListener: (...args) => serialEvents.addEventListener(...args),
      removeEventListener: (...args) => serialEvents.removeEventListener(...args)
    }
  });
  const createUrl = URL.createObjectURL.bind(URL);
  const revokeUrl = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = createUrl(blob);
    blobRegistry.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = url => { blobRegistry.delete(url); revokeUrl(url); };
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[download]');
    const blob = anchor && blobRegistry.get(anchor.href);
    if (!blob) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveFile(blob, anchor.download).catch(error => showMessage(error.message));
  }, true);
  document.documentElement.classList.add('mobile-native');
}

let dialog;
const $ = id => document.getElementById(id);
const showMessage = text => {
  const notice = $('ui-toast');
  if (notice) { notice.textContent = text; notice.hidden = false; }
};
const status = text => { $('mobile-connect-status').textContent = text; };

function buildDialog() {
  dialog = document.createElement('dialog');
  dialog.id = 'mobile-bluetooth-dialog';
  dialog.className = 'help-dialog mobile-bluetooth-dialog';
  dialog.setAttribute('aria-labelledby', 'mobile-bluetooth-title');
  dialog.innerHTML = `
    <h2 id="mobile-bluetooth-title">Connect over Bluetooth</h2>
    <p>First enable the AIRIZ radio with <code>diag ble on</code> from the USB console. Select only your device. A Bluetooth connection alone does not confirm motor-command support.</p>
    <label class="mobile-field">Transport<select id="mobile-transport"><option value="ble">Bluetooth LE · iPhone + Android</option>${platform === 'android' ? '<option value="classic">Paired Classic serial · Android</option>' : ''}</select></label>
    <div class="mobile-scan-actions"><button id="mobile-scan" class="btn btn-primary">Scan devices</button><button id="mobile-settings" class="btn">Phone Bluetooth settings</button></div>
    <p id="mobile-connect-status" role="status">No commands are sent during discovery.</p>
    <div id="mobile-device-list" class="mobile-device-list"></div>
    <details id="mobile-services" hidden><summary>Discovered services and diagnostics</summary><pre id="mobile-service-output"></pre></details>
    <section id="mobile-custom-profile" hidden>
      <h3>Unrecognized command channel</h3>
      <p>No recognized UART service was found. You can export diagnostics without writing anything. Do not select firmware-update, battery or settings services as a console.</p>
      <label class="mobile-field">Vendor service<select id="mobile-service-select"></select></label>
      <label class="mobile-field">Write characteristic<select id="mobile-write-select"></select></label>
      <label class="mobile-field">Notify characteristic<select id="mobile-notify-select"></select></label>
      <label class="checkbox-label"><input id="mobile-custom-confirm" type="checkbox">I intend to test this selected service as an AIRIZ text/UART channel.</label>
      <button id="mobile-verify-custom" class="btn btn-primary" disabled>Send firmware-version query</button>
    </section>
    <div class="mobile-dialog-actions"><button id="mobile-export-diagnostics" class="btn" disabled>Export diagnostics</button><button id="mobile-cancel" class="btn btn-secondary">Cancel</button></div>`;
  document.body.append(dialog);
  $('mobile-scan').addEventListener('click', scan);
  $('mobile-transport').addEventListener('change', scan);
  $('mobile-settings').addEventListener('click', async () => {
    try {
      if (platform === 'android') await Classic.openSettings();
      else status('On iPhone, turn Bluetooth on in Settings → Bluetooth. Grant AIRIZ Bluetooth access when iOS asks.');
    } catch (error) { status(error.message); }
  });
  $('mobile-cancel').addEventListener('click', cancel);
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  $('mobile-export-diagnostics').addEventListener('click', () => {
    if (!lastDiagnostics) return;
    saveFile(new Blob([JSON.stringify(lastDiagnostics, null, 2)], { type: 'application/json' }), 'airiz-bluetooth-diagnostics.json').catch(error => status(error.message));
  });
  $('mobile-custom-confirm').addEventListener('change', () => { $('mobile-verify-custom').disabled = !$('mobile-custom-confirm').checked; });
  $('mobile-service-select').addEventListener('change', updateCustomCharacteristics);
  $('mobile-verify-custom').addEventListener('click', async () => {
    if (!pending?.selected || !$('mobile-custom-confirm').checked || pending.busy) return;
    try {
      const profile = customProfile(pending.services, $('mobile-service-select').value, $('mobile-write-select').value, $('mobile-notify-select').value);
      await verifyLink(bleLink(pending.selected, profile, pending.disconnectRef));
    } catch (error) { await connectionError(error); }
  });
}

async function cancel() {
  const request = pending;
  pending = null;
  await stopScan();
  if (currentLink) await currentLink.close().catch(() => {});
  currentLink = null;
  if (request?.selected && request.mode === 'ble') await BleClient.disconnect(request.selected.deviceId).catch(() => {});
  if (dialog?.open) dialog.close();
  request?.reject(new DOMException('Bluetooth connection cancelled', 'AbortError'));
}

function chooseDevice() {
  if (pending) return Promise.reject(new Error('A Bluetooth connection request is already open.'));
  if (!dialog) buildDialog();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject, busy: false, selected: null, services: [], disconnectRef: { current: null }, mode: 'ble' };
    $('mobile-scan').disabled = false;
    $('mobile-transport').disabled = false;
    $('mobile-device-list').replaceChildren();
    $('mobile-services').hidden = true;
    $('mobile-custom-profile').hidden = true;
    $('mobile-export-diagnostics').disabled = !lastDiagnostics;
    status('Choose a transport, then tap Scan. Discovery is read-only; motor controls stay disabled until a firmware-version reply verifies the command channel.');
    dialog.showModal();
  });
}

async function scan() {
  if (!pending || pending.busy) return;
  await stopScan();
  if (pending.selected && pending.mode === 'ble') await BleClient.disconnect(pending.selected.deviceId).catch(() => {});
  pending.selected = null;
  pending.mode = $('mobile-transport').value;
  $('mobile-custom-profile').hidden = true;
  $('mobile-services').hidden = true;
  $('mobile-device-list').replaceChildren();
  status('Looking for devices…');
  try {
    if (pending.mode === 'classic') {
      const result = await Classic.bondedDevices();
      if (!pending) return;
      for (const device of result.devices) showDevice(device, 'Paired device');
      status(result.devices.length ? 'Choose your paired AIRIZ device. Only the standard serial/SPP service will be attempted.' : 'No paired devices. Pair the AIRIZ device in Android Bluetooth settings first.');
    } else {
      await ensureBle();
      if (!pending) return;
      await BleClient.requestLEScan({ allowDuplicates: false }, result => {
        if (pending && !pending.busy) showDevice({ ...result.device, name: result.device.name || result.localName }, typeof result.rssi === 'number' ? result.rssi + ' dBm' : 'BLE device');
      });
      status('Scanning BLE advertisements for 15 seconds. If AIRIZ is absent, its radio may not be advertising a BLE service.');
      scanTimer = setTimeout(async () => {
        await stopScan();
        if (pending && !pending.busy) status('Scan finished. Select your device or scan again. Bluetooth power-on alone does not create a control service.');
      }, 15000);
    }
  } catch (error) { status(error.message || 'Bluetooth is unavailable or permission was denied.'); }
}

function showDevice(device, detail) {
  if ([...$('mobile-device-list').children].some(child => child.dataset.deviceId === device.deviceId)) return;
  const button = document.createElement('button');
  button.className = 'mobile-device';
  button.dataset.deviceId = device.deviceId;
  const name = document.createElement('strong');
  name.textContent = device.name || 'Unnamed device';
  const description = document.createElement('span');
  description.textContent = detail + ' · ' + device.deviceId;
  button.append(name, description);
  button.addEventListener('click', () => connect(device));
  $('mobile-device-list').append(button);
}

function setBusy(value) {
  if (!pending) return;
  pending.busy = value;
  $('mobile-scan').disabled = value;
  $('mobile-transport').disabled = value;
  for (const button of $('mobile-device-list').children) button.disabled = value;
}

async function connect(device) {
  if (!pending || pending.busy) return;
  const request = pending;
  setBusy(true);
  await stopScan();
  if (request.selected && request.mode === 'ble') {
    request.disconnectRef.current = null;
    await BleClient.disconnect(request.selected.deviceId).catch(() => {});
  }
  request.disconnectRef = { current: null };
  request.selected = device;
  lastDiagnostics = { app: 'AIRIZ Mobile 1.0.0', platform, transport: request.mode, device: { id: device.deviceId, name: device.name || null }, capturedAt: new Date().toISOString(), services: [], motorCommandsSentDuringDiscovery: false };
  $('mobile-export-diagnostics').disabled = false;
  try {
    status('Connecting to ' + (device.name || device.deviceId) + '…');
    if (request.mode === 'classic') {
      const link = await classicLink(device);
      if (pending !== request) { await link.close(); return; }
      await verifyLink(link);
      return;
    }
    const disconnectRef = request.disconnectRef;
    await BleClient.connect(device.deviceId, () => disconnectRef.current?.(), { timeout: 12000 });
    if (pending !== request) { await BleClient.disconnect(device.deviceId); return; }
    request.services = await BleClient.getServices(device.deviceId);
    lastDiagnostics.services = request.services;
    $('mobile-service-output').textContent = JSON.stringify(request.services, null, 2);
    $('mobile-services').hidden = false;
    const known = discoverProfiles(request.services);
    if (known.length) {
      lastDiagnostics.profile = known[0];
      await verifyLink(bleLink(device, known[0], request.disconnectRef));
    } else {
      status('Bluetooth connected, but no recognized UART service is advertised. Motor controls are disabled. Inspect/export the discovered profile; custom probing is opt-in.');
      setBusy(false);
      showCustomProfile(request.services);
    }
  } catch (error) { await connectionError(error); }
}

function showCustomProfile(services) {
  const select = $('mobile-service-select');
  select.replaceChildren();
  for (const service of services) {
    const uuid = normalizeUuid(service.uuid);
    if (uuid.endsWith('-0000-1000-8000-00805f9b34fb') || uuid === '00001530-1212-efde-1523-785feabcd123') continue;
    const characteristics = service.characteristics;
    if (!characteristics.some(item => item.properties.write || item.properties.writeWithoutResponse)
        || !characteristics.some(item => item.properties.notify || item.properties.indicate)) continue;
    select.add(new Option(uuid, uuid));
  }
  $('mobile-custom-profile').hidden = select.options.length === 0;
  $('mobile-custom-confirm').checked = false;
  $('mobile-verify-custom').disabled = true;
  updateCustomCharacteristics();
}

function updateCustomCharacteristics() {
  for (const id of ['mobile-write-select', 'mobile-notify-select']) $(id).replaceChildren();
  const service = pending?.services.find(item => normalizeUuid(item.uuid) === $('mobile-service-select').value);
  for (const characteristic of service?.characteristics || []) {
    const uuid = normalizeUuid(characteristic.uuid);
    if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) $('mobile-write-select').add(new Option(uuid, uuid));
    if (characteristic.properties.notify || characteristic.properties.indicate) $('mobile-notify-select').add(new Option(uuid, uuid));
  }
}

async function verifyLink(link) {
  const request = pending;
  if (!request) { await link.close(); return; }
  setBusy(true);
  currentLink = link;
  status('Checking the existing AIRIZ text protocol with diag ver sw. No jog command is being sent.');
  const port = new VerifiedSerialPort(link, emitDisconnect);
  try {
    await port.open();
    if (pending !== request) { await port.close(); return; }
    lastDiagnostics.firmwareReply = port.probeText;
    lastDiagnostics.reportedFirmware = port.firmwareVersion;
    lastDiagnostics.commandChannelVerified = true;
    currentLink = null;
    pending = null;
    dialog.close();
    request.resolve(port);
  } catch (error) {
    if (lastDiagnostics) { lastDiagnostics.firmwareReply = port.probeText; lastDiagnostics.commandChannelVerified = false; }
    await connectionError(error);
  }
}

async function connectionError(error) {
  if (lastDiagnostics) lastDiagnostics.error = error.message;
  if (currentLink) await currentLink.close().catch(() => {});
  currentLink = null;
  if (pending?.selected && pending.mode === 'ble') await BleClient.disconnect(pending.selected.deviceId).catch(() => {});
  setBusy(false);
  $('mobile-custom-profile').hidden = true;
  status(error.message || 'The device connection could not be verified.');
}

function styleMobile() {
  for (const id of ['desktop-download-banner', 'mobile-download-banner', 'btn-install-app', 'baud-select', 'btn-bluetooth-on']) {
    const element = $(id);
    if (element) element.hidden = true;
  }
  $('btn-connect').textContent = 'Connect Bluetooth';
  document.querySelector('.connection-copy strong').textContent = 'Bluetooth device';
  $('transport-note').textContent = 'Discover services and verify the command channel, or try Demo.';
  const cameraHeading = document.querySelector('#view-camera .panel-header h2');
  if (cameraHeading) cameraHeading.textContent = 'Phone camera — local preview, not Bluetooth video';
  App.getInfo().then(info => {
    document.title = 'AIRIZ Mobile ' + info.version;
    document.querySelector('.page-intro .eyebrow').textContent = platform.toUpperCase() + ' / AIRIZ MOBILE ' + info.version;
    const badge = document.querySelector('.header-session');
    if (badge) badge.textContent = platform.toUpperCase() + ' APP / ' + info.version;
  });
  App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) stopScan();
  });
}

if (Capacitor.isNativePlatform()) {
  installMobile();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', styleMobile);
  else styleMobile();
}
