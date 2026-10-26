'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_GRANTS = 10;
const RECONNECT_WINDOW_MS = 15 * 60 * 1000;

// The serial chooser reports camelCase fields (vendorId, deviceInstanceId), but
// Electron's device-permission check passes snake_case ones (device_instance_id,
// often without vendor/product IDs). Accept both, or real ports never reopen.
function identity(device) {
  const pick = (...keys) => {
    for (const key of keys) {
      if (device?.[key] !== undefined && device?.[key] !== null && device?.[key] !== '') return String(device[key]);
    }
    return '';
  };
  return {
    vendorId: pick('vendorId', 'vendor_id'),
    productId: pick('productId', 'product_id'),
    serialNumber: pick('serialNumber', 'serial_number'),
    deviceInstanceId: pick('deviceInstanceId', 'device_instance_id')
  };
}

function sameDevice(first, second) {
  if (first.deviceInstanceId && second.deviceInstanceId) {
    return first.deviceInstanceId === second.deviceInstanceId;
  }
  return Boolean(first.vendorId) && first.vendorId === second.vendorId
    && first.productId === second.productId
    && first.serialNumber === second.serialNumber;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

// Serial ports the user explicitly selected are remembered so the app can reopen
// the same device after an update restart, without granting any other device.
function createGrantStore(directory) {
  const grantsFile = path.join(directory, 'serial-grants.json');
  const reconnectFile = path.join(directory, 'pending-reconnect.json');
  let grants = (readJson(grantsFile, { grants: [] }).grants || []).map(identity);

  return {
    remember(device) {
      const chosen = identity(device);
      if (!chosen.vendorId && !chosen.deviceInstanceId) return;
      grants = [...grants.filter(grant => !sameDevice(grant, chosen)), chosen].slice(-MAX_GRANTS);
      writeJson(grantsFile, { grants });
    },
    allows(device) {
      const candidate = identity(device);
      return grants.some(grant => sameDevice(grant, candidate));
    },
    forgetAll() {
      grants = [];
      writeJson(grantsFile, { grants });
    },
    savePendingReconnect(request, now = Date.now()) {
      const baudRate = Number(request?.baudRate);
      if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 4000000) return false;
      writeJson(reconnectFile, {
        baudRate,
        usbVendorId: Number.isInteger(request.usbVendorId) ? request.usbVendorId : null,
        usbProductId: Number.isInteger(request.usbProductId) ? request.usbProductId : null,
        expiresAt: now + RECONNECT_WINDOW_MS
      });
      return true;
    },
    takePendingReconnect(now = Date.now()) {
      const pending = readJson(reconnectFile, null);
      try {
        fs.rmSync(reconnectFile, { force: true });
      } catch {
        // A stale request is ignored below.
      }
      if (!pending || typeof pending.expiresAt !== 'number' || pending.expiresAt < now) return null;
      return {
        baudRate: pending.baudRate,
        usbVendorId: pending.usbVendorId,
        usbProductId: pending.usbProductId
      };
    }
  };
}

module.exports = { createGrantStore, identity, sameDevice, RECONNECT_WINDOW_MS };
